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
  "docs/product/pages/main-left-sidebar.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-main-left-sidebar-prototype-static-")
);
const evidencePath = resolve(artifactDir, "static-evidence.json");
const html = await readFile(prototypePath, "utf8");
const checks = [];

if (!html.includes('data-prototype="main-left-sidebar"')) {
  throw new Error("Published HTML is missing the main-left-sidebar marker.");
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
  "置顶",
  "标记为已读",
  "标记为未读",
  "重命名",
  "标题更新中",
  "同名区分与标题扩宽定位"
]) {
  if (!html.includes(requiredText)) {
    throw new Error(`Published HTML is missing required content: ${requiredText}`);
  }
}
checks.push("left-sidebar-and-right-tab-review-content");

for (const requiredContract of [
  "prefers-reduced-motion",
  "data-conversation-row",
  "data-right-tab-id",
  "shared-overlay",
  "right-tab-strip",
  "aria-selected",
  "context-menu",
  "rename-popover"
]) {
  if (!html.includes(requiredContract)) {
    throw new Error(
      `Published HTML is missing required interaction contract: ${requiredContract}`
    );
  }
}
checks.push("overlay-menu-rename-tab-focus-and-motion-contracts");

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
      prototype: "docs/product/pages/main-left-sidebar.prototype.html",
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
  `Verified static main-left-sidebar prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
);
