import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/flows/byok-agent-runtime.prototype.html"
);
const artifactDir = await mkdtemp(resolve(tmpdir(), "moebius-byok-prototype-interactive-"));
const evidencePath = resolve(artifactDir, "interactive-evidence.json");
const prototypeUrl = pathToFileURL(prototypePath).href;
const screenshots = [];
const checks = [];
const requests = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 920 },
  colorScheme: "dark",
  reducedMotion: "no-preference"
});
const page = await context.newPage();
page.on("request", (request) => requests.push(request.url()));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function screenshot(name) {
  const path = resolve(artifactDir, name);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
}

try {
  await page.goto(prototypeUrl);
  await page.getByTestId("onboarding-scene").waitFor();
  assert(
    await page.getByText("原型评审台", { exact: true }).isVisible(),
    "review controls must be visibly separated from the product surface"
  );
  assert(
    await page.getByText("环境准备", { exact: true }).isVisible(),
    "the prototype must start in onboarding environment preparation"
  );
  checks.push("starts-in-labeled-onboarding-prototype");

  await page.evaluate(() => window.__byokPrototype.failNextValidation());
  await page.getByLabel("档案名称").fill("工作档案");
  await page.getByLabel("API Key").fill("sk-prototype-only");
  await page.getByLabel("模型").selectOption("deepseek-chat");
  await page.getByRole("button", { name: "验证并保存" }).click();
  await page.getByRole("alert").waitFor();
  assert(
    await page.getByText("工具调用没有通过", { exact: true }).isVisible(),
    "the deterministic failure must keep the profile out of ready"
  );
  await page.getByRole("button", { name: "重试验证" }).click();
  await page.getByText("DeepSeek · 工作档案", { exact: true }).waitFor({ timeout: 5000 });
  assert(
    await page.getByText("已就绪", { exact: true }).isVisible(),
    "retry must complete model reply, tool call, and safe save"
  );
  await screenshot("01-onboarding-provider-ready-dark.png");
  checks.push("validation-failure-retry-and-safe-save");

  await page.getByRole("button", { name: /继续/ }).click();
  await page.getByRole("button", { name: "改用这个 API" }).click();
  await page.getByRole("dialog", { name: "改用这个 API" }).waitFor();
  await page.getByRole("button", { name: "确认更新" }).click();
  await page.getByText(/3 名成员已更新为 Pi API/).waitFor({ timeout: 3000 });
  assert(
    (await page.getByText(/3 名成员已更新为 Pi API/).count()) === 1,
    "the affected members must update as one visible result"
  );
  checks.push("atomic-team-rebinding");

  await page.getByRole("button", { name: /继续/ }).click();
  await page.getByText("接力演示", { exact: true }).waitFor();
  await page.getByRole("button", { name: /继续/ }).click();
  await page.getByText("准备就绪", { exact: true }).waitFor();
  await page.getByRole("button", { name: "开始使用" }).click();
  await page.getByRole("heading", { name: "BYOK Agent 运行时" }).waitFor();
  checks.push("four-step-onboarding-reaches-selected-team-conversation");

  await page.evaluate(() => window.__byokPrototype.setScene("settings"));
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await settingsDialog.waitFor();
  await page.getByRole("tab", { name: "模型" }).click();
  assert(
    await page.locator(".model-row strong", { hasText: "deepseek-reasoner" }).isVisible(),
    "settings must expose the verified model set"
  );
  await page.getByRole("tab", { name: "引用" }).click();
  assert(
    await page.getByText("可恢复会话", { exact: true }).isVisible(),
    "settings must separate recoverable conversation references"
  );
  await page.getByRole("tab", { name: "档案" }).click();
  await page.getByRole("button", { name: "停用档案" }).click();
  await page.getByRole("dialog", { name: "停用档案" }).getByRole("button", { name: "确认停用" }).click();
  assert(
    (await page.getByText("已停用", { exact: true }).count()) >= 1,
    "disabled status must remain visible with references preserved"
  );
  await page.getByRole("button", { name: "重新启用" }).click();
  await page.getByRole("dialog", { name: "重新启用档案" }).getByRole("button", { name: "验证并重新启用" }).click();
  assert(
    (await page.getByText("已就绪", { exact: true }).count()) >= 1,
    "re-enable must return the profile to ready"
  );
  await page.getByRole("button", { name: "删除" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "无法删除这份档案" });
  await deleteDialog.waitFor();
  assert(
    await deleteDialog.getByText("仍有运行引用", { exact: true }).isVisible(),
    "delete must be blocked while references remain"
  );
  await deleteDialog.getByRole("button", { name: "关闭" }).press("Escape");
  await screenshot("02-settings-lifecycle-dark.png");
  checks.push("settings-model-reference-disable-enable-and-delete-protection");

  await page.evaluate(() => window.__byokPrototype.setScene("teams"));
  await page.getByLabel("执行引擎").selectOption("Pi API");
  assert(
    await page.getByLabel("Provider").isVisible()
      && await page.getByLabel("思考程度").isVisible(),
    "Pi team configuration must reveal Provider, model, and actual effort"
  );
  await page.getByRole("button", { name: "保存运行配置" }).click();
  await page.getByText("已保存", { exact: true }).waitFor();
  checks.push("team-member-pi-provider-model-effort-save");

  await page.evaluate(() => {
    window.__byokPrototype.setScene("conversation");
    window.__byokPrototype.setConversationFixture("key-invalid");
  });
  await page.getByText("DeepSeek · 工作档案需要处理", { exact: true }).waitFor();
  await page.getByRole("button", { name: "换执行配置重跑…" }).click();
  const rerunDialog = page.getByRole("dialog", { name: "换执行配置重跑" });
  await rerunDialog.waitFor();
  assert(
    await rerunDialog.getByText("不会修改当前会话的冻结配置或团队成员设置。", { exact: true }).isVisible(),
    "one-time rerun must state that it does not migrate the conversation"
  );
  await rerunDialog.getByRole("button", { name: "关闭" }).press("Escape");
  await page.getByRole("button", { name: "前往设置修复" }).click();
  const repairDialog = page.getByRole("dialog", { name: "替换 API Key" });
  await repairDialog.waitFor();
  await repairDialog.getByRole("textbox", { name: /API Key/ }).fill("sk-repaired-prototype");
  await repairDialog.getByRole("button", { name: "验证并保存" }).click();
  await page.getByRole("button", { name: "返回原会话重试" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "返回原会话重试" }).click();
  await page.getByRole("heading", { name: "BYOK Agent 运行时" }).waitFor();
  checks.push("provider-repair-return-without-automatic-retry");

  await page.evaluate(() => window.__byokPrototype.setConversationFixture("model-removed"));
  await page.getByText("deepseek-reasoner 已不可用", { exact: true }).waitFor();
  await page.getByRole("button", { name: "迁移当前会话…" }).click();
  const migrationDialog = page.getByRole("dialog", { name: "迁移当前会话" });
  assert(
    await migrationDialog.getByText("不会修改团队默认配置", { exact: true }).isVisible(),
    "migration must preserve the team default"
  );
  await migrationDialog.getByRole("button", { name: "确认迁移" }).click();
  await page.getByText(/原生上下文已重新建立/).first().waitFor();
  await screenshot("03-conversation-migrated-dark.png");
  checks.push("model-removal-permanent-migration-and-context-rebuild");

  await page.keyboard.press("Alt+5");
  const agentPanel = page.locator(".agent-panel");
  await agentPanel.waitFor();
  await agentPanel.locator(".agent-tabs").getByRole("button", { name: "完整输出" }).click();
  assert(
    await agentPanel.getByText(/安全清洗后的详细过程/).isVisible()
      && await agentPanel.getByText("已整理较早上下文 · 同一 Pi 会话继续", { exact: true }).isVisible(),
    "single-Agent output must show the safe detailed Pi process and compression fact"
  );
  checks.push("keyboard-scene-navigation-and-safe-agent-output");

  await page.setViewportSize({ width: 560, height: 720 });
  await page.evaluate(() => window.__byokPrototype.setScene("settings"));
  await settingsDialog.waitFor();
  const dialogBox = await settingsDialog.boundingBox();
  const navBox = await page.locator(".settings-nav").boundingBox();
  const contentBox = await page.locator(".settings-content").boundingBox();
  assert(
    dialogBox && navBox && contentBox
      && contentBox.y >= navBox.y + navBox.height - 1
      && dialogBox.x >= 0
      && dialogBox.x + dialogBox.width <= 560,
    "narrow settings must stack navigation above scrollable content"
  );
  await page.getByRole("button", { name: "切换到亮色主题" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "review theme control must switch to the light token pair"
  );
  const duration = await page.locator(".button").first().evaluate(
    (element) => getComputedStyle(element).transitionDuration
  );
  assert(
    duration === "0.001ms" || duration === "1e-06s",
    "reduced motion must collapse transitions"
  );
  await screenshot("04-settings-narrow-light-reduced-motion.png");
  checks.push("narrow-light-and-reduced-motion");

  const externalRequests = requests.filter(
    (url) => !url.startsWith("file:") && !url.startsWith("data:")
  );
  assert(
    externalRequests.length === 0,
    `file prototype attempted external requests: ${externalRequests.join(", ")}`
  );
  checks.push("file-url-without-network-requests");

  await writeFile(
    evidencePath,
    `${JSON.stringify({
      prototype: "docs/product/flows/byok-agent-runtime.prototype.html",
      checkedAt: new Date().toISOString(),
      checks,
      screenshots
    }, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    `Verified interactive BYOK prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
  );
} finally {
  await browser.close();
}
