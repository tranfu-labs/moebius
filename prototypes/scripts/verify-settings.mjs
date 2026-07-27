import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/settings.prototype.html"
);
const artifactDir = resolve(
  repositoryRoot,
  "artifacts/acceptance/settings-prototype"
);
const evidencePath = resolve(artifactDir, "static-evidence.json");
const html = await readFile(prototypePath, "utf8");
const checks = [];

if (!html.includes('data-prototype="settings"')) {
  throw new Error("Published HTML is missing the settings marker.");
}
checks.push("prototype-marker");

const externalAttributes = [
  ...html.matchAll(/\b(?:src|href)=["']([^"'#][^"']*)["']/gu)
]
  .map((match) => match[1])
  .filter((value) => !value.startsWith("data:") && !value.startsWith("mailto:"));

if (externalAttributes.length > 0) {
  throw new Error(
    `Published HTML has external resource attributes: ${externalAttributes.join(", ")}`
  );
}
checks.push("single-html-has-no-external-resource-attributes");

for (const requiredText of [
  "设计原型",
  "非正式产品实现",
  "简体中文",
  "English",
  "无法保存语言设置",
  "Couldn’t save the language setting"
]) {
  if (!html.includes(requiredText)) {
    throw new Error(`Published HTML is missing required content: ${requiredText}`);
  }
}
checks.push("bilingual-and-prototype-content");

for (const requiredContract of [
  "prefers-reduced-motion",
  "prefers-color-scheme",
  "aria-modal",
  "localStorage",
  "saveSucceeded",
  "saveFailed",
  "aria-controls",
  "data-locale"
]) {
  if (!html.includes(requiredContract)) {
    throw new Error(
      `Published HTML is missing required interaction contract: ${requiredContract}`
    );
  }
}
checks.push("persistence-failure-focus-theme-and-motion-contracts");

for (const forbiddenVisual of [
  "linear-gradient(",
  "radial-gradient(",
  "box-shadow:"
]) {
  if (html.includes(forbiddenVisual)) {
    throw new Error(
      `Published HTML contains a forbidden visual treatment: ${forbiddenVisual}`
    );
  }
}
checks.push("no-gradient-or-shadow");

for (const forbiddenNetworkPrimitive of [
  "XMLHttpRequest(",
  "new WebSocket(",
  "fetch(\"http",
  "fetch('http"
]) {
  if (html.includes(forbiddenNetworkPrimitive)) {
    throw new Error(
      `Published HTML contains a network primitive: ${forbiddenNetworkPrimitive}`
    );
  }
}
checks.push("no-network-primitive");

for (const forbiddenProductCoupling of [
  "src/",
  "desktop/",
  "packages/console-ui",
  "sites/"
]) {
  if (html.includes(`from ${forbiddenProductCoupling}`)) {
    throw new Error(
      `Published HTML contains a forbidden product dependency: ${forbiddenProductCoupling}`
    );
  }
}
checks.push("no-production-runtime-coupling");

await mkdir(artifactDir, { recursive: true });
await writeFile(
  evidencePath,
  `${JSON.stringify(
    {
      prototype: "docs/product/pages/settings.prototype.html",
      sha256: createHash("sha256").update(html).digest("hex"),
      checkedAt: new Date().toISOString(),
      checks
    },
    null,
    2
  )}\n`,
  "utf8"
);

process.stdout.write(
  `Verified static settings prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
);
