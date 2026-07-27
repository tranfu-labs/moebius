import { render, screen } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { I18nProvider, translate, useI18n } from "./index";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

describe("console UI i18n", () => {
  it("keeps locale resources aligned", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    for (const key of Object.keys(zhCN) as Array<keyof typeof zhCN>) {
      const placeholders = (value: string) =>
        [...value.matchAll(/\{([A-Za-z0-9_]+)\}/gu)].map((match) => match[1]).sort();
      expect(placeholders(en[key]), key).toEqual(placeholders(zhCN[key]));
    }
  });

  it("renders the selected bundled resource", () => {
    function Fixture(): JSX.Element {
      const { t } = useI18n();
      return <p>{t("settings.title")}</p>;
    }

    const view = render(
      <I18nProvider locale="zh-CN"><Fixture /></I18nProvider>,
    );
    expect(screen.getByText("设置")).toBeVisible();

    view.rerender(<I18nProvider locale="en"><Fixture /></I18nProvider>);
    expect(screen.getByText("Settings")).toBeVisible();
  });

  it("interpolates values without evaluating them", () => {
    expect(translate("en", "settings.title", { unused: "<script>" })).toBe("Settings");
  });

  it("keeps locale copy branching out of the migrated production components", async () => {
    const sources = await Promise.all([
      readFile(path.join(process.cwd(), "src/console/operator-console.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "src/console/settings-dialog.tsx"), "utf8"),
    ]);
    for (const source of sources) {
      expect(source).not.toMatch(/\blocale\s*(?:===|!==)|switch\s*\(\s*locale\b|\blocale\s*\?/u);
    }
  });
});
