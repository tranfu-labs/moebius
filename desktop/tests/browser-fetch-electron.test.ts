import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe("browser fetch Electron receiver", () => {
  it("calls Chromium's native window.fetch through the receiver-safe adapter", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "text/plain",
      });
      response.end("receiver-ok");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Electron fetch test server did not expose a TCP port");
      }
      const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-browser-fetch-"));
      temporaryDirectories.push(temporaryDirectory);
      const bundlePath = path.join(temporaryDirectory, "renderer.js");
      const browserFetchPath = fileURLToPath(
        new URL("../src/console-page/browser-fetch.ts", import.meta.url),
      );
      await build({
        stdin: {
          contents: [
            `import { invokeBrowserFetch } from ${JSON.stringify(browserFetchPath)};`,
            `window.__moebiusFetchResult = invokeBrowserFetch(window.fetch, ${JSON.stringify(
              `http://127.0.0.1:${String(address.port)}/receiver`,
            )}).then((response) => response.text());`,
          ].join("\n"),
          resolveDir: temporaryDirectory,
          sourcefile: "renderer-entry.ts",
        },
        bundle: true,
        format: "iife",
        outfile: bundlePath,
        platform: "browser",
      });
      const htmlPath = path.join(temporaryDirectory, "index.html");
      await fs.writeFile(
        htmlPath,
        "<!doctype html><meta charset=\"utf-8\"><script src=\"./renderer.js\"></script>",
        "utf8",
      );
      const mainPath = path.join(temporaryDirectory, "main.cjs");
      await fs.writeFile(mainPath, `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await window.loadFile(${JSON.stringify(htmlPath)});
  const result = await window.webContents.executeJavaScript("window.__moebiusFetchResult");
  process.stdout.write("MOEBIUS_FETCH_RESULT:" + result + "\\n");
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\\n");
  app.exit(1);
});
`, "utf8");

      await expect(runElectron(mainPath)).resolves.toContain("MOEBIUS_FETCH_RESULT:receiver-ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});

async function runElectron(mainPath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" ? ["--no-sandbox", mainPath] : [mainPath];
    const child = spawn(electronExecutable, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Electron fetch regression timed out: ${stderr}`));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Electron fetch regression exited ${String(code)}: ${stderr}`));
      }
    });
  });
}
