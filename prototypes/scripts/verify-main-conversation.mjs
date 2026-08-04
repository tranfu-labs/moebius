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
  "docs/product/pages/main-conversation.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-main-conversation-prototype-static-")
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
  "主会话 · 团队版本",
  "当前主会话消息目录",
  "暂时收起",
  "下次定位失败",
  "产品交付负责人",
  "界面原型师",
  "实施负责人",
  "无法定位到原消息，已保持当前阅读位置",
  "切换到其他团队",
  "当前团队的修改不会在这里原地更新",
  "官方来源",
  "用户团队",
  "内置：交付团队",
  "Agent 定义已更新",
  "运行配置已更新",
  "团队信息已更新",
  "当前工作结束后应用团队更新",
  "重试应用",
  "取消应用并继续使用当前版本",
  "等待团队更新",
  "实际执行配置",
  "本次计划尝试 · 未开始执行",
  "本次绑定配置 · 是否开始未记录",
  "此项未记录",
  "团队版本载入于",
  "查看 AGENT.md",
  "已保存，无需重启",
  "保存全部并离开",
  "未保存，仍使用上一次保存的版本"
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
