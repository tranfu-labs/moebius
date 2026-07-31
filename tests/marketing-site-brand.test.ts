import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(repoRoot, "sites/marketeam");

describe("marketing site brand", () => {
  it("publishes the canonical logo, favicon, and Apple Touch Icon", async () => {
    const html = await readFile(path.join(siteRoot, "index.html"), "utf8");

    expect(html).toContain('href="./assets/favicon-32.png"');
    expect(html).toContain('href="./assets/apple-touch-icon.png"');
    expect(html).toContain('src="./assets/moebius-icon-64.png"');
    expect(html).not.toContain('rel="icon" href="data:,"');
    await Promise.all([
      access(path.join(siteRoot, "assets/favicon-32.png")),
      access(path.join(siteRoot, "assets/apple-touch-icon.png")),
      access(path.join(siteRoot, "assets/moebius-icon-64.png")),
    ]);
  });

  it("discloses the Apple Silicon platform scope for every download entry", async () => {
    const html = await readFile(path.join(siteRoot, "index.html"), "utf8");

    const downloadEntries = html.match(/href="[^"]*\/releases\/latest"[^>]*data-download/g) ?? [];
    const platformDisclosures = html.match(/Apple Silicon/g) ?? [];

    expect(downloadEntries.length).toBeGreaterThan(0);
    expect(platformDisclosures.length).toBeGreaterThanOrEqual(downloadEntries.length);
    expect(html).toContain("macOS 14+");
  });

  it("links source, releases, and every download entry to the public GitHub repository", async () => {
    const html = await readFile(path.join(siteRoot, "index.html"), "utf8");

    expect(html).toContain('href="https://github.com/tranfu-labs/moebius"');
    expect(html).toContain('href="https://github.com/tranfu-labs/moebius/releases"');
    expect(html.match(/href="https:\/\/github\.com\/tranfu-labs\/moebius\/releases\/latest"[^>]*data-download/g)).toHaveLength(
      3,
    );
    expect(html).toContain("https://api.github.com/repos/tranfu-labs/moebius/releases/latest");
    expect(html).toContain("/-mac-arm64\\.dmg$/i");
  });
});
