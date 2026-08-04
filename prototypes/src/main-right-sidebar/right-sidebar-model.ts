/*
 * 主页面右侧栏设计原型 · 宽度/布局/开合动效纯模型。
 * 产品事实源：docs/product/pages/main-right-sidebar.md
 * 探索对象：默认 50% 与双面最小 480px、分隔线鼠标与键盘调整、
 * 并排/覆盖布局边界、150ms 开合与中途反向、偏好只收敛不覆盖。
 * 本文件不 import 任何正式产品实现。
 */

export const MIN_SIDEBAR_WIDTH = 480;
export const SIDE_BY_SIDE_MIN_AVAILABLE = 960;
export const DEFAULT_WIDTH_RATIO = 0.5;
export const MAX_WIDTH_RATIO = 0.75;
export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_LARGE = 64;
export const TOGGLE_DURATION_MS = 150;

export type SidebarLayout = "side-by-side" | "overlay";

/** 可用内容宽度达到 960px 时并排，否则覆盖。 */
export function layoutForAvailableWidth(availableWidth: number): SidebarLayout {
  return availableWidth >= SIDE_BY_SIDE_MIN_AVAILABLE
    ? "side-by-side"
    : "overlay";
}

/** 无用户偏好时的默认宽度：可用内容宽度的 50%，取整误差不超过 1px。 */
export function defaultSidebarWidth(availableWidth: number): number {
  return Math.round(availableWidth * DEFAULT_WIDTH_RATIO);
}

/** 当前最大宽度：75% 与「给主会话保留 480px」两者取小。 */
export function maxSidebarWidth(availableWidth: number): number {
  return Math.min(
    Math.round(availableWidth * MAX_WIDTH_RATIO),
    availableWidth - MIN_SIDEBAR_WIDTH
  );
}

/** 呈现值只按当前边界收敛，不回写偏好。 */
export function clampSidebarWidth(
  width: number,
  availableWidth: number
): number {
  const upper = Math.max(maxSidebarWidth(availableWidth), MIN_SIDEBAR_WIDTH);
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), upper);
}

/** 当前应呈现的宽度：偏好缺省时取默认比例，越界时仅临时收敛。 */
export function presentSidebarWidth(
  preference: number | null,
  availableWidth: number
): number {
  return clampSidebarWidth(
    preference ?? defaultSidebarWidth(availableWidth),
    availableWidth
  );
}

export type ResizerKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** 分隔线键盘调整：← 扩大 16px，→ 缩小 16px，Shift 64px，Home/End 到边界。 */
export function keyboardWidthTarget(
  currentWidth: number,
  key: ResizerKey,
  shiftKey: boolean,
  availableWidth: number
): number {
  const step = shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampSidebarWidth(currentWidth + step, availableWidth);
    case "ArrowRight":
      return clampSidebarWidth(currentWidth - step, availableWidth);
    case "Home":
      return MIN_SIDEBAR_WIDTH;
    case "End":
      return Math.max(maxSidebarWidth(availableWidth), MIN_SIDEBAR_WIDTH);
  }
}

/* ------------------------------------------------------------------ */
/* 150ms 开合动效：从当下进度立即反向，不排队、不跳回端点。           */
/* ------------------------------------------------------------------ */

export interface ToggleMotion {
  /** 本段运动起始进度（0 关 .. 1 开）。 */
  from: number;
  to: 0 | 1;
  startedAt: number;
  duration: number;
}

/**
 * 开始一段开合运动。当前进度即为目标时返回 null（无运动）。
 * 段时长按剩余距离等比取值，保证全程展开/收起恰为 150ms，
 * 中途反向时从当下进度继续，不重新计时整段。
 */
export function beginToggle(
  currentProgress: number,
  target: 0 | 1,
  now: number
): ToggleMotion | null {
  if (currentProgress === target) return null;
  return {
    from: currentProgress,
    to: target,
    startedAt: now,
    duration: TOGGLE_DURATION_MS * Math.abs(target - currentProgress)
  };
}

export function toggleProgressAt(motion: ToggleMotion, now: number): number {
  const raw = (now - motion.startedAt) / motion.duration;
  const t = Math.min(1, Math.max(0, raw));
  return motion.from + (motion.to - motion.from) * easeStandard(t);
}

export function isToggleComplete(motion: ToggleMotion, now: number): boolean {
  return now >= motion.startedAt + motion.duration;
}

/** 无弹性标准缓动 cubic-bezier(0.4, 0, 0.2, 1)。 */
export function easeStandard(x: number): number {
  return cubicBezier(0.4, 0, 0.2, 1, x);
}

function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const cx = bezier(x1, x2, t) - x;
    const dx = bezierDerivative(x1, x2, t);
    if (Math.abs(cx) < 1e-6) return bezier(y1, y2, t);
    if (Math.abs(dx) < 1e-6) break;
    t -= cx / dx;
  }
  let lo = 0;
  let hi = 1;
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (bezier(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return bezier(y1, y2, (lo + hi) / 2);
}

function bezier(a1: number, a2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t;
}

function bezierDerivative(a1: number, a2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * a1 + 6 * u * t * (a2 - a1) + 3 * t * t * (1 - a2);
}
