import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Desktop runtime provider call-site inventory", () => {
  it("keeps every concrete Codex entry point explicitly classified", async () => {
    const files = await productionTypeScriptFiles([
      path.join(projectRoot, "src"),
      path.join(projectRoot, "desktop", "src"),
    ]);
    const concreteCodexImports: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      const codexImports = source.match(
        /import[^;]+from ["'][^"']*codex\.js["'];?/g,
      ) ?? [];
      if (codexImports.some((statement) =>
        !/^import\s+type\b/.test(statement.trim())
        && /\brun as runCodex\b/.test(statement)
      )) {
        concreteCodexImports.push(path.relative(projectRoot, file));
      }
    }

    expect(concreteCodexImports.sort()).toEqual([
      "desktop/src/ai-team-builder/codex-spawner.ts",
      "src/format-ceo.ts",
      "src/local-console/execution-driver.ts",
      "src/local-console/server.ts",
      "src/runner.ts",
    ]);
  });

  it("keeps every concrete Kimi entry point explicitly classified", async () => {
    const files = await productionTypeScriptFiles([
      path.join(projectRoot, "src"),
      path.join(projectRoot, "desktop", "src"),
    ]);
    const concreteKimiImports: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      const kimiImports = source.match(
        /import[^;]+from ["'][^"']*kimi\.js["'];?/g,
      ) ?? [];
      if (kimiImports.some((statement) =>
        !/^import\s+type\b/.test(statement.trim())
        && /\brunKimiAcp\b/.test(statement)
      )) {
        concreteKimiImports.push(path.relative(projectRoot, file));
      }
    }

    expect(concreteKimiImports.sort()).toEqual([
      "desktop/src/ai-team-builder/kimi-spawner.ts",
      "src/local-console/execution-driver.ts",
    ]);
  });

  it("keeps Claude limited to local console and isolated AI team building", async () => {
    const files = await productionTypeScriptFiles([
      path.join(projectRoot, "src"),
      path.join(projectRoot, "desktop", "src"),
    ]);
    const concreteClaudeImports: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      if (
        /from ["'][^"']*claude\.js["']/.test(source)
        && /\brunClaude\b/.test(source)
      ) {
        concreteClaudeImports.push(path.relative(projectRoot, file));
      }
    }
    expect(concreteClaudeImports.sort()).toEqual([
      "desktop/src/ai-team-builder/claude-spawner.ts",
      "src/local-console/execution-driver.ts",
    ]);
    expect(await read("src/runner.ts")).not.toContain("runClaude");
  });

  it("injects the active desktop data root into the local console provider runtime", async () => {
    const main = await read("desktop/src/main.ts");
    const callStart = main.indexOf("localConsoleServer = await startLocalConsoleServer({");
    const callEnd = main.indexOf("\n    });", callStart);

    expect(callStart).toBeGreaterThan(-1);
    expect(callEnd).toBeGreaterThan(callStart);
    expect(main.slice(callStart, callEnd)).toContain([
      "port: 0,",
      "      dataRoot: status.dataRoot,",
      "      projectRoot: status.dataRoot,",
    ].join("\n"));
  });

  it("keeps each persistent Agent call site fail-closed on its own provider identity", async () => {
    const localDriver = await read("src/local-console/execution-driver.ts");
    expect(localDriver).toContain('kind: "resume"');
    expect(localDriver).toContain('kind: "full"');
    expect(localDriver).toContain("onThreadStarted");
    expect(localDriver).toContain("onSessionStarted");
    expect(localDriver).toContain("assertSuccessfulSessionIdentity");

    const aiCodex = await read("desktop/src/ai-team-builder/codex-spawner.ts");
    expect(aiCodex).toContain("resolveThread");
    expect(aiCodex).toContain("writeInvocationManifest");
    expect(aiCodex).toContain("resume-unavailable:");
    expect(aiCodex).not.toContain("reconstruction");

    const aiKimi = await read("desktop/src/ai-team-builder/kimi-spawner.ts");
    expect(aiKimi).toContain('kind: "resume"');
    expect(aiKimi).toContain("writeInvocationManifest");
    expect(aiKimi).toContain("assertExternalSessionIdentity");
    expect(aiKimi).not.toContain("reconstruction");

    const aiClaude = await read("desktop/src/ai-team-builder/claude-spawner.ts");
    expect(aiClaude).toContain('kind: "resume"');
    expect(aiClaude).toContain("assertExternalSessionIdentity");
    expect(aiClaude).not.toContain("reconstruction");

    const githubRunner = await read("src/runner.ts");
    expect(githubRunner).toContain("resolveCodexThread");
    expect(githubRunner).toContain("threadStatePersisted");
    expect(githubRunner.match(/dependencies\.runCodex\(\{/g)).toHaveLength(1);
    expect(githubRunner).not.toContain("-fallback");

    for (const source of [localDriver, aiCodex, aiKimi, aiClaude, githubRunner]) {
      expect(source).not.toContain("full-fallback");
    }
  });

  it("keeps auxiliary inference full and detached from Agent session state", async () => {

    const auxiliarySources = await Promise.all([
      read("src/local-console/route-bus.ts"),
      read("src/format-ceo.ts"),
    ]);
    for (const source of auxiliarySources) {
      expect(source).toContain('mode: { kind: "full" }');
      expect(source).not.toContain("recordAgentSessionLink");
      expect(source).not.toContain("recordAgentTimelineCursor");
    }
  });
});

async function read(relativePath: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

async function productionTypeScriptFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...await productionTypeScriptFiles([target]));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(target);
      }
    }
  }
  return files;
}
