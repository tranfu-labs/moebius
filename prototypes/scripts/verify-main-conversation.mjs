import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/main-conversation.prototype.html"
);
const artifactDir = resolve(
  repositoryRoot,
  "artifacts/acceptance/main-conversation-prototype"
);
const evidencePath = resolve(artifactDir, "static-evidence.json");
const html = await readFile(prototypePath, "utf8");
const checks = [];

if (!html.includes('data-prototype="main-conversation"')) {
  throw new Error("Published HTML is missing the main conversation marker.");
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

if (!html.includes("设计原型") || !html.includes("非正式产品实现")) {
  throw new Error("Published HTML does not identify itself as a design prototype.");
}
checks.push("prototype-disclaimer");

for (const requiredText of [
  "主会话目录轨",
  "当前主会话消息目录",
  "暂时收起",
  "下次定位失败",
  "产品交付负责人",
  "界面原型师",
  "实施负责人",
  "无法定位到原消息，已保持当前阅读位置"
]) {
  if (!html.includes(requiredText)) {
    throw new Error(`Published HTML is missing required fixture text: ${requiredText}`);
  }
}
checks.push("interactive-fixture-content");

for (const requiredContract of [
  "ResizeObserver",
  "prefers-reduced-motion",
  "data-rail-event",
  "event-preview-card",
  "aria-current",
  "scrollIntoView"
]) {
  if (!html.includes(requiredContract)) {
    throw new Error(
      `Published HTML is missing required interaction contract: ${requiredContract}`
    );
  }
}
checks.push("responsive-keyboard-location-and-motion-contracts");

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

await mkdir(artifactDir, { recursive: true });
await writeFile(
  evidencePath,
  `${JSON.stringify(
    {
      prototype: "docs/product/pages/main-conversation.prototype.html",
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
  `Verified static main conversation prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
);
