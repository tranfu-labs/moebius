const esbuildDynamicRequireMarker = "Dynamic require of \"";
const staticRequirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/gu;
const sandboxedPreloadAllowedRequires = new Set(["electron"]);

export function assertStaticNodeBundle(source, label = "Node bundle") {
  if (source.includes(esbuildDynamicRequireMarker)) {
    throw new Error(`${label} contains an unsupported esbuild dynamic require shim`);
  }
}

export function assertSandboxedPreloadBundle(source, label = "preload.cjs") {
  assertStaticNodeBundle(source, label);
  const unsupportedRequires = [...source.matchAll(staticRequirePattern)]
    .map((match) => match[1])
    .filter((specifier) => specifier !== undefined && !sandboxedPreloadAllowedRequires.has(specifier));
  if (unsupportedRequires.length > 0) {
    const uniqueSpecifiers = [...new Set(unsupportedRequires)].sort();
    throw new Error(
      `${label} requires modules unavailable in Electron's sandboxed preload: ${uniqueSpecifiers.join(", ")}`,
    );
  }
}
