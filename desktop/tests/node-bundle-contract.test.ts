import { describe, expect, it } from "vitest";

import {
  assertSandboxedPreloadBundle,
  assertStaticNodeBundle,
} from "../scripts/node-bundle-contract.mjs";

describe("desktop Node bundle contract", () => {
  it("accepts a native ESM bundle", () => {
    expect(() => assertStaticNodeBundle("import process from 'node:process';", "main.js")).not.toThrow();
  });

  it("rejects esbuild's runtime dynamic require shim", () => {
    const bundle = `throw Error('Dynamic require of "' + name + '" is not supported')`;

    expect(() => assertStaticNodeBundle(bundle, "main.js")).toThrow(
      /main\.js contains an unsupported esbuild dynamic require shim/u,
    );
  });

  it("accepts a sandboxed preload that uses the process global without requiring it", () => {
    expect(() => assertSandboxedPreloadBundle("const platform = process.platform;"))
      .not.toThrow();
  });

  it("accepts Electron's renderer bridge module", () => {
    expect(() => assertSandboxedPreloadBundle("const electron = require('electron');"))
      .not.toThrow();
  });

  it.each([
    "require(\"process\")",
    "require('node:process')",
    "require('node:path')",
    "require('node:fs')",
    "require('node:crypto')",
    "require('node:child_process')",
  ])(
    "rejects a sandboxed preload containing %s",
    (source) => {
      expect(() => assertSandboxedPreloadBundle(source, "preload.cjs")).toThrow(
        /preload\.cjs requires modules unavailable in Electron's sandboxed preload/u,
      );
    },
  );

  it("reports every unsupported module in a generated preload bundle", () => {
    const source = [
      "require('electron');",
      "require('node:path');",
      "require('node:fs');",
      "require('node:path');",
    ].join("\n");

    expect(() => assertSandboxedPreloadBundle(source, "preload.cjs")).toThrow(
      /node:fs, node:path/u,
    );
  });
});
