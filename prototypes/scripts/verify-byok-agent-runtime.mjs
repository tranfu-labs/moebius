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
  "docs/product/flows/byok-agent-runtime.prototype.html"
);
const artifactDir = await mkdtemp(resolve(tmpdir(), "moebius-byok-prototype-static-"));
const evidencePath = resolve(artifactDir, "static-evidence.json");
const html = await readFile(prototypePath, "utf8");
const checks = [];

if (!html.includes('data-prototype="byok-agent-runtime"')) {
  throw new Error("Published HTML is missing the BYOK prototype marker.");
}
checks.push("prototype-marker");

const externalAttributes = [
  ...html.matchAll(/\b(?:src|href)=["']([^"'#][^"']*)["']/gu)
]
  .map((match) => match[1])
  .filter((value) => !value.startsWith("data:") && !value.startsWith("mailto:"));
if (externalAttributes.length > 0) {
  throw new Error(`Published HTML has external resource attributes: ${externalAttributes.join(", ")}`);
}
checks.push("single-html-has-no-external-resource-attributes");

for (const requiredText of [
  "设计原型",
  "非正式产品实现",
  "环境准备",
  "AI 服务商",
  "Agent 团队",
  "换执行配置重跑",
  "迁移当前会话",
  "已整理较早上下文"
]) {
  if (!html.includes(requiredText)) {
    throw new Error(`Published HTML is missing required content: ${requiredText}`);
  }
}
checks.push("five-scenes-and-critical-recovery-content");

for (const contract of [
  "prefers-reduced-motion",
  "data-theme",
  "aria-modal",
  "__byokPrototype",
  "failNextValidation",
  "validation-failed"
]) {
  if (!html.includes(contract)) {
    throw new Error(`Published HTML is missing required interaction contract: ${contract}`);
  }
}
checks.push("deterministic-theme-motion-keyboard-and-failure-contracts");

for (const forbiddenVisual of ["linear-gradient(", "radial-gradient(", "box-shadow:"]) {
  if (html.includes(forbiddenVisual)) {
    throw new Error(`Published HTML contains forbidden visual treatment: ${forbiddenVisual}`);
  }
}
checks.push("no-gradient-or-shadow");

for (const primitive of ["XMLHttpRequest(", "new WebSocket(", "fetch(\"http", "fetch('http"]) {
  if (html.includes(primitive)) {
    throw new Error(`Published HTML contains a network primitive: ${primitive}`);
  }
}
checks.push("no-network-primitive");

await writeFile(
  evidencePath,
  `${JSON.stringify({
    prototype: "docs/product/flows/byok-agent-runtime.prototype.html",
    sha256: createHash("sha256").update(html).digest("hex"),
    checkedAt: new Date().toISOString(),
    checks
  }, null, 2)}\n`,
  "utf8"
);

process.stdout.write(`Verified static BYOK prototype (${checks.length} checks). Evidence: ${evidencePath}\n`);
