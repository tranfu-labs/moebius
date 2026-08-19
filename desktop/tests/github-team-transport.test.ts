import { describe, expect, it } from "vitest";

import type { GithubCommandResult } from "../src/github-team-contract.js";
import { createGithubTeamTransport, GithubTeamTransportError } from "../src/github-team-transport.js";

interface Call {
  command: string;
  args: readonly string[];
}

function fakeRunner(result: GithubCommandResult | Error) {
  const calls: Call[] = [];
  const run = async (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, run };
}

function httpResponse(status: number, body: string, headers: Record<string, string> = {}): GithubCommandResult {
  return {
    exitCode: status >= 200 && status < 300 ? 0 : 1,
    stdout: [
      `HTTP/2.0 ${String(status)} ${status === 200 ? "OK" : "Error"}`,
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
      "",
      body,
    ].join("\n"),
    stderr: status >= 200 && status < 300 ? "" : `gh api failed with status ${String(status)}`,
  };
}

describe("GitHub team transport", () => {
  it("uses gh api GET with explicit query fields and parses rate headers", async () => {
    const fake = fakeRunner(httpResponse(200, JSON.stringify({
      total_count: 0,
      incomplete_results: false,
      items: [],
    }), {
      "X-Ratelimit-Limit": "30",
      "X-Ratelimit-Remaining": "29",
      "X-Ratelimit-Reset": "1787046633",
      "X-Ratelimit-Resource": "search",
    }));
    const transport = createGithubTeamTransport({ runCommand: fake.run, now: () => 1_787_000_000_000 });

    const result = await transport.searchRepositories({ query: "team", language: "en", perPage: 12 });

    expect(result.data.totalCount).toBe(0);
    expect(result.rateLimit).toMatchObject({ limit: 30, remaining: 29, resource: "search" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.command).toBe("gh");
    expect(fake.calls[0]?.args).toEqual(expect.arrayContaining([
      "api",
      "--hostname",
      "github.com",
      "search/repositories",
      "--method",
      "GET",
      "--include",
      "--raw-field",
      "q=team in:name,description topic:moebius-team topic:moebius-team-en",
      "--raw-field",
      "per_page=12",
    ]));
  });

  it("reads repository metadata and base64 file content through typed DTOs", async () => {
    const responses = [
      httpResponse(200, JSON.stringify({
        full_name: "someone/team",
        name: "team",
        description: "A team",
        stargazers_count: 2,
        updated_at: "2026-08-18T00:00:00Z",
        private: false,
        topics: ["moebius-team", "moebius-team-zh"],
        default_branch: "main",
        html_url: "https://github.com/someone/team",
      })),
      httpResponse(200, JSON.stringify({
        type: "file",
        path: "team.json",
        sha: "abc",
        size: 14,
        content: Buffer.from('{"name":"team"}\n', "utf8").toString("base64"),
      })),
    ];
    const calls: Call[] = [];
    const transport = createGithubTeamTransport({
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return responses.shift()!;
      },
    });

    await expect(transport.readRepository("someone/team")).resolves.toMatchObject({
      data: { repository: "someone/team", defaultBranch: "main" },
    });
    await expect(transport.readRepositoryContent({ repository: "someone/team", path: "team.json", ref: "main" }))
      .resolves.toMatchObject({ data: { type: "file", content: '{"name":"team"}\n' } });
    expect(calls[1]?.args).toEqual(expect.arrayContaining(["--raw-field", "ref=main"]));
  });

  it("reads the repository root with the contents endpoint without a trailing path", async () => {
    const fake = fakeRunner(httpResponse(200, JSON.stringify([
      { type: "file", path: "team.json", sha: "abc", size: 12 },
    ])));
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.readRepositoryContent({ repository: "someone/team", path: "" }))
      .resolves.toMatchObject({ data: [{ path: "team.json", type: "file" }] });
    expect(fake.calls[0]?.args).toContain("repos/someone/team/contents");
  });

  it("treats an unauthenticated auth-status exit as public-only access", async () => {
    const fake = fakeRunner({ exitCode: 1, stdout: "", stderr: "not logged in" });
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.readAuthStatus()).resolves.toEqual({
      authenticated: false,
      cliAvailable: true,
      login: null,
    });
  });

  it("reports a missing gh CLI without converting it into authenticated state", async () => {
    const missing = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    const fake = fakeRunner(missing);
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.readAuthStatus()).resolves.toEqual({
      authenticated: false,
      cliAvailable: false,
      login: null,
    });
    await expect(transport.readRepository("someone/team")).rejects.toMatchObject({ code: "CLI_MISSING" });
  });

  it.each([
    [403, { "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": "1787046633" }, "RATE_LIMITED"],
    [403, {}, "PERMISSION_DENIED"],
    [404, {}, "NOT_FOUND"],
    [503, {}, "NETWORK_UNAVAILABLE"],
  ] as const)("maps HTTP %s to %s", async (status, headers, code) => {
    const fake = fakeRunner(httpResponse(status, JSON.stringify({ message: "request failed" }), headers));
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.readRepository("someone/team")).rejects.toMatchObject({ code });
  });

  it("uses Retry-After to identify secondary rate limits", async () => {
    const fake = fakeRunner(httpResponse(429, JSON.stringify({ message: "secondary rate limit" }), {
      "Retry-After": "12",
    }));
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.readRepository("someone/team")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { rateLimit: { retryAfterSeconds: 12 } },
    });
  });

  it("classifies network and invalid protocol failures", async () => {
    const network = fakeRunner({ exitCode: 1, stdout: "", stderr: "could not resolve host github.com" });
    const networkTransport = createGithubTeamTransport({ runCommand: network.run });
    await expect(networkTransport.readRepository("someone/team")).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });

    const invalid = fakeRunner(httpResponse(200, "not json"));
    const invalidTransport = createGithubTeamTransport({ runCommand: invalid.run });
    await expect(invalidTransport.readRepository("someone/team")).rejects.toBeInstanceOf(GithubTeamTransportError);
    await expect(invalidTransport.readRepository("someone/team")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects unsafe repository paths before spawning gh", async () => {
    const fake = fakeRunner(httpResponse(200, "[]"));
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.readRepositoryContent({ repository: "someone/team", path: "../team.json" }))
      .rejects.toMatchObject({ code: "HTTP_ERROR" });
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects invalid search page sizes", async () => {
    const fake = fakeRunner(httpResponse(200, JSON.stringify({ total_count: 0, items: [] })));
    const transport = createGithubTeamTransport({ runCommand: fake.run });

    await expect(transport.searchRepositories({ query: "team", language: "all", perPage: 101 }))
      .rejects.toMatchObject({ code: "HTTP_ERROR" });
    expect(fake.calls).toHaveLength(0);
  });
});
