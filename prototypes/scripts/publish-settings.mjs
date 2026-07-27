import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const builtPath = resolve(packageRoot, "dist/src/settings/index.html");
const destinationPath = resolve(
  repositoryRoot,
  "docs/product/pages/settings.prototype.html"
);
const temporaryPath = `${destinationPath}.tmp`;

const html = await readFile(builtPath, "utf8");

if (!html.includes('data-prototype="settings"')) {
  throw new Error("Built HTML is missing the settings prototype marker.");
}

const externalAttributes = [];
const attributePattern = /\b(?:src|href)=["']([^"']+)["']/gu;
let match;

while ((match = attributePattern.exec(html)) !== null) {
  const value = match[1];
  if (
    value.startsWith("data:")
    || value.startsWith("#")
    || value.startsWith("mailto:")
  ) {
    continue;
  }
  externalAttributes.push(value);
}

if (externalAttributes.length > 0) {
  throw new Error(
    `Self-contained prototype contains external resource attributes: ${externalAttributes.join(", ")}`
  );
}

const generatedBanner =
  "<!-- GENERATED from prototypes/src/settings/. Design prototype only; product facts live in docs/product/pages/settings.md. -->";
const publishedHtml = html.replace(
  "<!doctype html>",
  `<!doctype html>\n${generatedBanner}`
);

await mkdir(dirname(destinationPath), { recursive: true });
await rm(temporaryPath, { force: true });
await writeFile(temporaryPath, publishedHtml, "utf8");
await rename(temporaryPath, destinationPath);

process.stdout.write(
  `Published self-contained settings prototype: ${destinationPath}\n`
);
