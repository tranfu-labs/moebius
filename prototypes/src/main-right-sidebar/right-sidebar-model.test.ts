/*
 * 右侧栏宽度/布局/开合动效模型的行为测试。
 * 红了意味着「50% 默认、480 最小、75%/主会话保底最大、960 布局边界、
 * 键盘步进、150ms 与中途反向」中的某条 PRD 规则被改坏。
 */
import { describe, expect, it } from "vitest";

import {
  MIN_SIDEBAR_WIDTH,
  TOGGLE_DURATION_MS,
  beginToggle,
  clampSidebarWidth,
  defaultSidebarWidth,
  easeStandard,
  isToggleComplete,
  keyboardWidthTarget,
  layoutForAvailableWidth,
  maxSidebarWidth,
  presentSidebarWidth,
  toggleProgressAt
} from "./right-sidebar-model.js";

describe("layoutForAvailableWidth", () => {
  it("960px 及以上并排，959px 覆盖", () => {
    expect(layoutForAvailableWidth(1200)).toBe("side-by-side");
    expect(layoutForAvailableWidth(960)).toBe("side-by-side");
    expect(layoutForAvailableWidth(959)).toBe("overlay");
  });
});

describe("默认与边界宽度", () => {
  it("无偏好时默认取可用宽度的 50%，取整误差不超过 1px", () => {
    expect(presentSidebarWidth(null, 1200)).toBe(600);
    expect(presentSidebarWidth(null, 960)).toBe(480);
    expect(defaultSidebarWidth(1201)).toBe(601);
  });

  it("最大宽度取 75% 与主会话保底 480px 的较小者", () => {
    expect(maxSidebarWidth(1200)).toBe(720);
    expect(maxSidebarWidth(1440)).toBe(960);
    expect(maxSidebarWidth(960)).toBe(480);
  });

  it("呈现值只在边界内收敛，不覆盖原偏好；空间恢复后还原", () => {
    expect(presentSidebarWidth(300, 1200)).toBe(MIN_SIDEBAR_WIDTH);
    expect(presentSidebarWidth(900, 1200)).toBe(720);
    expect(presentSidebarWidth(900, 1000)).toBe(520);
    expect(presentSidebarWidth(900, 1440)).toBe(900);
  });

  it("clamp 在 960px 边界处最小值与最大值同为 480px", () => {
    expect(clampSidebarWidth(700, 960)).toBe(480);
    expect(clampSidebarWidth(200, 960)).toBe(480);
  });
});

describe("分隔线键盘调整", () => {
  it("← 扩大 16px，→ 缩小 16px，Shift 步进 64px", () => {
    expect(keyboardWidthTarget(600, "ArrowLeft", false, 1200)).toBe(616);
    expect(keyboardWidthTarget(600, "ArrowRight", false, 1200)).toBe(584);
    expect(keyboardWidthTarget(600, "ArrowLeft", true, 1200)).toBe(664);
    expect(keyboardWidthTarget(600, "ArrowRight", true, 1200)).toBe(536);
  });

  it("Home 到最小宽度，End 到当前最大宽度", () => {
    expect(keyboardWidthTarget(600, "Home", false, 1200)).toBe(480);
    expect(keyboardWidthTarget(600, "End", false, 1200)).toBe(720);
  });

  it("抵达边界后继续调整保持在边界，不越界", () => {
    expect(keyboardWidthTarget(480, "ArrowRight", false, 1200)).toBe(480);
    expect(keyboardWidthTarget(720, "ArrowLeft", false, 1200)).toBe(720);
  });
});

describe("150ms 开合动效", () => {
  it("全程展开/收起恰为 150ms，端点精确到达", () => {
    const opening = beginToggle(0, 1, 1000);
    expect(opening).not.toBeNull();
    expect(opening!.duration).toBe(TOGGLE_DURATION_MS);
    expect(toggleProgressAt(opening!, 1000)).toBe(0);
    expect(toggleProgressAt(opening!, 1150)).toBe(1);
    expect(isToggleComplete(opening!, 1149)).toBe(false);
    expect(isToggleComplete(opening!, 1150)).toBe(true);
  });

  it("中途反向从当下进度开始，不跳回端点，剩余时长等比", () => {
    const opening = beginToggle(0, 1, 1000)!;
    const midway = toggleProgressAt(opening, 1075);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);

    const reversed = beginToggle(midway, 0, 1075)!;
    expect(reversed.from).toBe(midway);
    expect(reversed.duration).toBeCloseTo(TOGGLE_DURATION_MS * midway, 6);
    expect(toggleProgressAt(reversed, 1075)).toBeCloseTo(midway, 6);
    expect(toggleProgressAt(reversed, 1075 + reversed.duration)).toBe(0);
  });

  it("当前进度即为目标时不产生运动", () => {
    expect(beginToggle(1, 1, 0)).toBeNull();
    expect(beginToggle(0, 0, 0)).toBeNull();
  });

  it("标准缓动无弹性：单调且端点为 0 与 1", () => {
    expect(easeStandard(0)).toBe(0);
    expect(easeStandard(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 20; i += 1) {
      const value = easeStandard(i / 20);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});
