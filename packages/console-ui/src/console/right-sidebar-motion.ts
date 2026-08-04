export const RIGHT_SIDEBAR_TOGGLE_DURATION_MS = 150;

export interface RightSidebarToggleMotion {
  from: number;
  to: 0 | 1;
  startedAt: number;
  duration: number;
}

export function startRightSidebarToggleMotion(
  currentProgress: number,
  target: 0 | 1,
  now: number,
): RightSidebarToggleMotion | null {
  const progress = clampProgress(currentProgress);
  if (progress === target) return null;
  return {
    from: progress,
    to: target,
    startedAt: now,
    duration: RIGHT_SIDEBAR_TOGGLE_DURATION_MS * Math.abs(target - progress),
  };
}

export function rightSidebarToggleProgressAt(
  motion: RightSidebarToggleMotion,
  now: number,
): number {
  if (motion.duration === 0) return motion.to;
  const elapsedRatio = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.duration));
  const eased = standardEase(elapsedRatio);
  return motion.from + (motion.to - motion.from) * eased;
}

export function rightSidebarToggleComplete(
  motion: RightSidebarToggleMotion,
  now: number,
): boolean {
  return now >= motion.startedAt + motion.duration;
}

function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}

function standardEase(x: number): number {
  return cubicBezier(0.25, 0.46, 0.45, 0.94, x);
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let index = 0; index < 8; index += 1) {
    const difference = bezierCoordinate(x1, x2, t) - x;
    if (Math.abs(difference) < 1e-6) break;
    const derivative = bezierDerivative(x1, x2, t);
    if (Math.abs(derivative) < 1e-6) break;
    t -= difference / derivative;
  }
  return bezierCoordinate(y1, y2, Math.min(1, Math.max(0, t)));
}

function bezierCoordinate(point1: number, point2: number, t: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * point1
    + 3 * inverse * t * t * point2
    + t * t * t;
}

function bezierDerivative(point1: number, point2: number, t: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * point1
    + 6 * inverse * t * (point2 - point1)
    + 3 * t * t * (1 - point2);
}
