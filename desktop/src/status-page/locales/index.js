import { en } from "./en.js";
import { zhCN } from "./zh-CN.js";

const resources = Object.freeze({
  "zh-CN": zhCN,
  en,
});

export function resolveStatusPageLocale(candidate) {
  return Object.hasOwn(resources, candidate) ? candidate : "zh-CN";
}

export function translateStatusPage(locale, key, values = {}) {
  return resources[resolveStatusPageLocale(locale)][key].replace(
    /\{([A-Za-z0-9_]+)\}/gu,
    (placeholder, name) => values[name] === undefined ? placeholder : String(values[name]),
  );
}
