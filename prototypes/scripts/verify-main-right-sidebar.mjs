import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/main-right-sidebar.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-main-right-sidebar-prototype-static-")
);
const evidencePath = resolve(artifactDir, "static-evidence.json");
const html = await readFile(prototypePath, "utf8");
const checks = [];

if (!html.includes('data-prototype="main-right-sidebar"')) {
  throw new Error("Published HTML is missing the main-right-sidebar marker.");
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
  "这个标签要看什么",
  "调整右侧栏宽度",
  "显示右侧栏",
  "这段对话期间，项目发生了这些改动",
  "减少动态效果"
]) {
  if (!html.includes(requiredText)) {
    throw new Error(`Published HTML is missing required content: ${requiredText}`);
  }
}
checks.push("right-sidebar-review-content");

for (const requiredContract of [
  "prefers-reduced-motion",
  "right-tab-strip",
  "aria-valuenow",
  "aria-valuemin",
  "aria-valuemax",
  "separator",
  "aria-expanded",
  "data-layout"
]) {
  if (!html.includes(requiredContract)) {
    throw new Error(
      `Published HTML is missing required interaction contract: ${requiredContract}`
    );
  }
}
checks.push("width-resizer-toggle-and-motion-contracts");

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

await writeFile(
  evidencePath,
  `${JSON.stringify(
    {
      prototype: "docs/product/pages/main-right-sidebar.prototype.html",
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
  `Verified static main-right-sidebar prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
);
