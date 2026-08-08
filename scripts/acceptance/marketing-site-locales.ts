/**
 * marketing-site 双语言验收。
 *
 * 在真实 Chromium 中以静态 HTTP 服务打开 `sites/marketeam/`，逐条断言
 * `openspec/specs/marketing-site/spec.md` 的语言路由、语言切换、本地化完整性与窄屏页头
 * Requirement。不依赖运行时、Electron 或网络：GitHub Releases API 允许失败，脚本只断言
 * 下载链接的后备行为。
 *
 * 用法：pnpm exec tsx scripts/acceptance/marketing-site-locales.ts
 * 证据（截图）写入脚本打印的系统临时目录。
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, "../../sites/marketeam");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/** Minimal static server with the trailing-slash behaviour real static hosts use. */
async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const requested = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const resolved = path.resolve(siteRoot, "." + requested);
    if (!resolved.startsWith(siteRoot)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let filePath = resolved;
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        if (!requested.endsWith("/")) {
          res.writeHead(301, { Location: requested + "/" }).end();
          return;
        }
        filePath = path.join(resolved, "index.html");
      }
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const body = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("server has no port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const results: string[] = [];
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/**
 * The Releases lookup and Google Fonts are allowed to fail; the page keeps working and the
 * download fallback is asserted on its own. Everything else counts as a defect.
 */
function isAllowedNetworkNoise(text: string): boolean {
  return /api\.github\.com|fonts\.(googleapis|gstatic)\.com/u.test(text)
    || /Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED/u.test(text);
}

async function main(): Promise<void> {
  const evidenceDir = await createAcceptanceOutputDirectory("marketing-site-locales");
  const server = await startServer();
  const browser: Browser = await chromium.launch();

  const openContext = async (
    locale: string,
    options: Parameters<Browser["newContext"]>[0] = {},
  ): Promise<{ context: BrowserContext; errors: string[] }> => {
    const context = await browser.newContext({
      locale,
      viewport: { width: 1440, height: 900 },
      ...options,
    });
    const errors: string[] = [];
    context.on("page", (page) => {
      page.on("console", (message) => {
        if (message.type() === "error" && !isAllowedNetworkNoise(message.text())) {
          errors.push(`console: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
      page.on("requestfailed", (request) => {
        if (!isAllowedNetworkNoise(request.url())) errors.push(`requestfailed: ${request.url()}`);
      });
      page.on("response", (response) => {
        if (response.url().startsWith(server.origin) && response.status() >= 400) {
          errors.push(`http ${response.status()}: ${response.url()}`);
        }
      });
    });
    return { context, errors };
  };

  const pathOf = (page: Page): string => new URL(page.url()).pathname;
  const settle = (page: Page): Promise<void> => page.waitForTimeout(600);

  try {
    // Requirement: 英文是默认语言 —— 英文浏览器停在根路径
    {
      const { context, errors } = await openContext("en-US");
      const page = await context.newPage();
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      await settle(page);
      check("en browser stays on /", pathOf(page) === "/", page.url());
      check("root declares lang=en", (await page.getAttribute("html", "lang")) === "en");
      check("root headline is English", /Your whole dev team,/u.test((await page.textContent("h1")) ?? ""));
      check(
        "root uses the English product preview",
        ((await page.getAttribute(".hero-shot-frame img", "src")) ?? "").endsWith("preview-center-en.png"),
      );
      check("root hreflang alternates are declared",
        (await page.locator('link[rel="alternate"][hreflang="en"]').count()) === 1
        && (await page.locator('link[rel="alternate"][hreflang="zh-Hans"]').count()) === 1
        && (await page.locator('link[rel="alternate"][hreflang="x-default"]').count()) === 1);
      check("root has no unexpected errors", errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // Requirement: 根路径按浏览器语言落到对应语言
    {
      const { context, errors } = await openContext("zh-CN");
      const page = await context.newPage();
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      await settle(page);
      check("zh browser lands on /zh/", pathOf(page) === "/zh/", page.url());
      check("/zh/ declares lang=zh-CN", (await page.getAttribute("html", "lang")) === "zh-CN");
      check(
        "/zh/ uses the Chinese product preview",
        ((await page.getAttribute(".hero-shot-frame img", "src")) ?? "").endsWith("preview-center.png"),
      );
      check("/zh/ has no unexpected errors", errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // Scenario: 浏览器「后退」回到来源页，而不是回到根路径
    {
      const { context } = await openContext("zh-CN");
      const page = await context.newPage();
      await page.goto(`${server.origin}/zh/#manifesto`, { waitUntil: "networkidle" });
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      await settle(page);
      check("redirect target reached", pathOf(page) === "/zh/", page.url());
      await page.goBack({ waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      check("Back skips the redirecting root", page.url().endsWith("/zh/#manifesto"), page.url());
      await context.close();
    }

    // Scenario: 分享出去的中文链接对非中文浏览器仍是中文
    {
      const { context } = await openContext("en-US");
      const page = await context.newPage();
      await page.goto(`${server.origin}/zh/`, { waitUntil: "networkidle" });
      await settle(page);
      check("en browser stays on /zh/ (no reverse redirect)", pathOf(page) === "/zh/", page.url());
      await context.close();
    }

    // Requirement: 页头语言切换控件 + 显式选择被记住
    {
      const { context } = await openContext("en-US");
      const page = await context.newPage();
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      check(
        "current language is marked with aria-current",
        (await page.getAttribute('.lang-menu a[hreflang="en"]', "aria-current")) === "true"
        && (await page.getAttribute('.lang-menu a[hreflang="zh-Hans"]', "aria-current")) === null,
      );
      await page.click(".lang > summary");
      check("menu opens", await page.isVisible('.lang-menu a[hreflang="zh-Hans"]'));
      await page.screenshot({ path: path.join(evidenceDir, "en-language-menu.png") });
      await page.click('.lang-menu a[hreflang="zh-Hans"]');
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      check("choosing 简体中文 lands on /zh/", pathOf(page) === "/zh/", page.url());
      check("?lang is cleared from the address bar", !page.url().includes("lang="), page.url());
      check(
        "the choice is remembered as zh",
        (await page.evaluate(() => localStorage.getItem("moebius-site-lang"))) === "zh",
      );

      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      await settle(page);
      check("a remembered zh sends an en browser to /zh/", pathOf(page) === "/zh/", page.url());

      await page.click(".lang > summary");
      await page.click('.lang-menu a[hreflang="en"]');
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      check("choosing English lands on /", pathOf(page) === "/", page.url());
      check(
        "the choice is remembered as en",
        (await page.evaluate(() => localStorage.getItem("moebius-site-lang"))) === "en",
      );
      await context.close();
    }

    // Scenario: 显式选择压过浏览器语言
    {
      const { context } = await openContext("zh-CN");
      const page = await context.newPage();
      await page.goto(`${server.origin}/zh/`, { waitUntil: "networkidle" });
      await page.click(".lang > summary");
      await page.click('.lang-menu a[hreflang="en"]');
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      check("a zh browser can switch to English", pathOf(page) === "/", page.url());
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      await settle(page);
      check("explicit en beats the zh browser language on revisit", pathOf(page) === "/", page.url());
      await context.close();
    }

    // Requirement: 语言记忆失败时安全降级
    {
      const { context, errors } = await openContext("en-US");
      await context.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("storage blocked");
          },
        });
      });
      const page = await context.newPage();
      await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
      await settle(page);
      check("no storage: root still renders", /Your whole dev team,/u.test((await page.textContent("h1")) ?? ""));
      check("no storage: no unexpected errors", errors.length === 0, errors.join(" | "));
      await page.click(".lang > summary");
      await page.click('.lang-menu a[hreflang="zh-Hans"]');
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      check("no storage: switching still works", pathOf(page) === "/zh/", page.url());
      await context.close();
    }

    // Requirement: 两页各自是完整可读的静态 HTML，语言控件无脚本可用
    {
      const context = await browser.newContext({
        locale: "en-US",
        javaScriptEnabled: false,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(`${server.origin}/`, { waitUntil: "load" });
      check("no JS: English copy is in the HTML", /Your whole dev team,/u.test((await page.textContent("h1")) ?? ""));
      check("no JS: no automatic redirect", pathOf(page) === "/");
      await page.click(".lang > summary");
      check("no JS: <details> opens", await page.isVisible('.lang-menu a[hreflang="zh-Hans"]'));
      await page.click('.lang-menu a[hreflang="zh-Hans"]');
      await page.waitForLoadState("load");
      check("no JS: switching reaches /zh/", pathOf(page) === "/zh/", page.url());
      check("no JS: Chinese copy is in the HTML", /把整个开发团队/u.test((await page.textContent("h1")) ?? ""));
      await context.close();
    }

    // Requirement: 单个语言版本内不出现另一语言的残留
    {
      const enHtml = await fs.readFile(path.join(siteRoot, "index.html"), "utf8");
      // 允许的例外：语言菜单里对方语言的自名、字体族名、语言标记本身
      const allowed = ["简体中文", "PingFang SC", "zh-Hans", "zh_CN", "zh-CN"];
      let scanned = enHtml;
      for (const token of allowed) scanned = scanned.split(token).join("");
      const cjk = scanned.match(/[一-鿿]/gu) ?? [];
      check("English page has no Chinese leftovers", cjk.length === 0, cjk.slice(0, 12).join(""));

      const zhHtml = await fs.readFile(path.join(siteRoot, "zh/index.html"), "utf8");
      check("Chinese page keeps its Chinese copy", zhHtml.includes("把整个开发团队"));
      check("Chinese page declares lang=zh-CN", zhHtml.includes('<html lang="zh-CN">'));
    }

    // 结构平价：两页只允许在文案、语言标记、资源相对深度与语言脚本上不同
    {
      const enHtml = await fs.readFile(path.join(siteRoot, "index.html"), "utf8");
      const zhHtml = await fs.readFile(path.join(siteRoot, "zh/index.html"), "utf8");
      const hooks = (html: string): string[] => html.match(/data-od-id="[^"]*"/gu) ?? [];
      check(
        "both pages expose the same DOM hooks",
        JSON.stringify(hooks(enHtml)) === JSON.stringify(hooks(zhHtml)),
      );
      const mainScript = (html: string): string => {
        const at = html.indexOf("document.documentElement.classList.add");
        return at < 0 ? "" : html.slice(at);
      };
      check(
        "both pages share a byte-identical main script",
        mainScript(enHtml).length > 0 && mainScript(enHtml) === mainScript(zhHtml),
      );
    }

    // Requirement: 页头在窄视口不溢出（并覆盖到更窄的真实机型宽度）
    for (const [label, route, locale] of [
      ["en", "/", "en-US"],
      ["zh", "/zh/", "zh-CN"],
    ] as const) {
      for (const width of [320, 360, 375, 390, 768, 900, 1440]) {
        const { context, errors } = await openContext(locale, { viewport: { width, height: 812 } });
        const page = await context.newPage();
        await page.goto(server.origin + route, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          navHeight: Math.round(document.querySelector(".nav-in")!.getBoundingClientRect().height),
          downloadVisible: Boolean((document.querySelector('[data-od-id="nav-download"]') as HTMLElement).offsetParent),
          languageVisible: Boolean((document.querySelector(".lang") as HTMLElement).offsetParent),
        }));
        check(
          `${label} ${width}px: no page-level horizontal scroll`,
          metrics.scrollWidth <= metrics.clientWidth,
          `${metrics.scrollWidth} vs ${metrics.clientWidth}`,
        );
        check(`${label} ${width}px: header stays on one line`, metrics.navHeight <= 68, `navHeight=${metrics.navHeight}`);
        check(`${label} ${width}px: download stays visible`, metrics.downloadVisible);
        check(`${label} ${width}px: language control stays visible`, metrics.languageVisible);
        if (width === 375) {
          await page.click(".lang > summary");
          await page.waitForTimeout(250);
          const menu = await page.evaluate(() => {
            const rect = document.querySelector(".lang-menu")!.getBoundingClientRect();
            return { left: rect.left, right: rect.right, viewport: window.innerWidth };
          });
          check(
            `${label} 375px: language menu stays in view`,
            menu.left >= 0 && menu.right <= menu.viewport,
            JSON.stringify(menu),
          );
          await page.screenshot({ path: path.join(evidenceDir, `${label}-375-header.png`) });
        }
        check(`${label} ${width}px: no unexpected errors`, errors.length === 0, errors.join(" | "));
        await context.close();
      }
    }

    // Requirement: 下载链接可用且可降级
    for (const [label, route, locale] of [
      ["en", "/", "en-US"],
      ["zh", "/zh/", "zh-CN"],
    ] as const) {
      const { context } = await openContext(locale);
      await context.route("https://api.github.com/**", (route_) => route_.abort());
      const page = await context.newPage();
      await page.goto(server.origin + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      const hrefs = await page.$$eval("[data-download]", (nodes) =>
        nodes.map((node) => node.getAttribute("href")),
      );
      check(
        `${label}: with the GitHub API down every download link falls back to releases/latest`,
        hrefs.length === 3
          && hrefs.every((href) => href === "https://github.com/tranfu-labs/moebius/releases/latest"),
        JSON.stringify(hrefs),
      );
      await context.close();
    }

    // Requirement: 尊重 prefers-reduced-motion
    for (const [label, route, locale] of [
      ["en", "/", "en-US"],
      ["zh", "/zh/", "zh-CN"],
    ] as const) {
      const { context, errors } = await openContext(locale, { reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(server.origin + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      const readable = await page.evaluate(() =>
        [...document.querySelectorAll("h1, .sub, .manifesto h2, .f-text h2, .cta h2, .footer .tag")].every(
          (node) => getComputedStyle(node).opacity !== "0" && (node.textContent ?? "").trim().length > 0,
        ),
      );
      check(`${label}: reduced motion keeps headings and body copy readable`, readable);
      check(`${label}: reduced motion has no unexpected errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // 视觉证据
    for (const [label, route, locale] of [
      ["en", "/", "en-US"],
      ["zh", "/zh/", "zh-CN"],
    ] as const) {
      const context = await browser.newContext({ locale, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(server.origin + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(2200);
      await page.screenshot({ path: path.join(evidenceDir, `${label}-hero.png`) });
      for (const anchor of ["#f-agents", "#f-conversation", "#f-diff"]) {
        await page.evaluate((selector) => {
          document.querySelector(selector)!.scrollIntoView({ block: "center" });
        }, anchor);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(evidenceDir, `${label}-${anchor.slice(1)}.png`) });
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(evidenceDir, `${label}-footer.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(results.join("\n"));
  console.log(`\nEvidence: ${evidenceDir}`);
  console.log(`${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) {
    console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}

await main();
