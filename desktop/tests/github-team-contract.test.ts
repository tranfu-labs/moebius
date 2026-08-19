import { describe, expect, it } from "vitest";

import {
  buildGithubRepositorySearchQuery,
  normalizeGithubRepository,
  parseGithubAuthStatus,
  parseGithubRepositoryContent,
  parseGithubRepositoryMetadata,
  parseGithubSearchResponse,
} from "../src/github-team-contract.js";

describe("GitHub team contract", () => {
  it("builds a repository-only search query with the required topics", () => {
    expect(buildGithubRepositorySearchQuery({ query: "content team", language: "zh" }))
      .toBe("content team in:name,description topic:moebius-team topic:moebius-team-zh");
    expect(buildGithubRepositorySearchQuery({ query: "", language: "all" }))
      .toBe("topic:moebius-team");
  });

  it("normalizes only safe owner/repository identities", () => {
    expect(normalizeGithubRepository("someone/team"))
      .toBe("someone/team");
    expect(normalizeGithubRepository(" someone/team "))
      .toBe("someone/team");
    expect(normalizeGithubRepository("../team"))
      .toBeNull();
    expect(normalizeGithubRepository("someone/team/more"))
      .toBeNull();
    expect(normalizeGithubRepository("someone/team name"))
      .toBeNull();
  });

  it("reads the active GitHub host without exposing credentials", () => {
    expect(parseGithubAuthStatus({
      hosts: {
        "github.com": [{ state: "success", active: true, login: "alice", tokenSource: "keyring" }],
      },
    })).toEqual({ authenticated: true, cliAvailable: true, login: "alice" });
    expect(parseGithubAuthStatus({ hosts: { "github.com": [{ state: "failed", active: false }] } }))
      .toEqual({ authenticated: false, cliAvailable: true, login: null });
  });

  it("parses search items and derives the language only from topics", () => {
    expect(parseGithubSearchResponse({
      total_count: 1,
      incomplete_results: false,
      items: [{
        full_name: "someone/team",
        name: "team",
        description: null,
        stargazers_count: 4,
        updated_at: "2026-08-18T00:00:00Z",
        private: true,
        topics: ["moebius-team", "moebius-team-en"],
      }],
    })).toEqual({
      totalCount: 1,
      incompleteResults: false,
      items: [{
        repository: "someone/team",
        name: "team",
        description: "",
        stars: 4,
        updatedAt: "2026-08-18T00:00:00Z",
        language: "en",
        private: true,
        topics: ["moebius-team", "moebius-team-en"],
      }],
    });
  });

  it("rejects malformed repository metadata and content", () => {
    expect(() => parseGithubRepositoryMetadata({ full_name: "not a repo" })).toThrow(/invalid full_name/u);
    expect(() => parseGithubRepositoryContent({ type: "file", path: "x", sha: "abc" })).toThrow(/content/u);
    expect(() => parseGithubSearchResponse({ total_count: -1, items: [] })).toThrow(/invalid payload/u);
  });

  it("decodes file content and keeps directory entries typed", () => {
    expect(parseGithubRepositoryContent({
      type: "file",
      path: "team.json",
      sha: "abc",
      size: 13,
      encoding: "base64",
      content: Buffer.from('{"name":"x"}\n', "utf8").toString("base64"),
    })).toEqual({
      type: "file",
      path: "team.json",
      sha: "abc",
      size: 13,
      content: '{"name":"x"}\n',
    });
    expect(parseGithubRepositoryContent([{ type: "dir", path: "members", sha: "def" }]))
      .toEqual([{ type: "dir", path: "members", sha: "def", size: null }]);
  });
});
