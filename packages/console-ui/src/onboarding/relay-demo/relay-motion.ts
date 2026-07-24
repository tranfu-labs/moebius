import { useEffect, useMemo, useState } from "react";

const STANDARD_BEAT_MS = 1_700;
const STANDARD_MIN_MS = 8_000;
const STANDARD_MAX_MS = 12_000;
const STANDARD_FIRST_BEAT_MS = 700;
const STANDARD_FINISH_HOLD_MS = 800;
const STANDARD_TYPING_LEAD_MS = 520;
const REDUCED_FIRST_BEAT_MS = 120;
const REDUCED_BEAT_MS = 260;
const REDUCED_TYPING_LEAD_MS = 80;

export interface RelayPlaybackTiming {
  totalDurationMs: number;
  revealOffsetsMs: number[];
  typingOffsetsMs: number[];
}

export interface RelayPlaybackState {
  activeIndex: number;
  complete: boolean;
  reducedMotion: boolean;
  timing: RelayPlaybackTiming;
  typingIndex: number;
  visibleCount: number;
}

export function parseRelayDurationToken(value: string, fallbackMs: number): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)(ms|s)$/u.exec(value.trim());
  if (match === null) {
    return fallbackMs;
  }
  const duration = Number(match[1]);
  return match[2] === "s" ? duration * 1_000 : duration;
}

export function createRelayPlaybackTiming(
  beatCount: number,
  reducedMotion: boolean,
): RelayPlaybackTiming {
  if (!Number.isInteger(beatCount) || beatCount < 1) {
    throw new Error("Relay playback requires at least one beat.");
  }

  if (reducedMotion) {
    const revealOffsetsMs = Array.from(
      { length: beatCount },
      (_, index) => REDUCED_FIRST_BEAT_MS + index * REDUCED_BEAT_MS,
    );
    return {
      revealOffsetsMs,
      totalDurationMs: revealOffsetsMs.at(-1)! + REDUCED_BEAT_MS,
      typingOffsetsMs: revealOffsetsMs.map((offset) =>
        Math.max(0, offset - REDUCED_TYPING_LEAD_MS)),
    };
  }

  const totalDurationMs = Math.min(
    STANDARD_MAX_MS,
    Math.max(STANDARD_MIN_MS, beatCount * STANDARD_BEAT_MS),
  );
  const lastRevealMs = totalDurationMs - STANDARD_FINISH_HOLD_MS;
  const stepMs = beatCount === 1
    ? 0
    : (lastRevealMs - STANDARD_FIRST_BEAT_MS) / (beatCount - 1);
  const revealOffsetsMs = Array.from(
    { length: beatCount },
    (_, index) => Math.round(STANDARD_FIRST_BEAT_MS + index * stepMs),
  );
  return {
    totalDurationMs,
    revealOffsetsMs,
    typingOffsetsMs: revealOffsetsMs.map((offset) =>
      Math.max(0, offset - STANDARD_TYPING_LEAD_MS)),
  };
}

export function useRelayPlayback(input: {
  beatCount: number;
  relayRun: number;
  reducedMotion?: boolean;
}): RelayPlaybackState {
  const systemReducedMotion = usePrefersReducedMotion();
  const reducedMotion = input.reducedMotion ?? systemReducedMotion;
  const timing = useMemo(
    () => createRelayPlaybackTiming(input.beatCount, reducedMotion),
    [input.beatCount, reducedMotion],
  );
  const [visibleCount, setVisibleCount] = useState(0);
  const [typingIndex, setTypingIndex] = useState(-1);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    setVisibleCount(0);
    setTypingIndex(-1);
    setComplete(false);
    const timers = timing.revealOffsetsMs.flatMap((delay, index) => [
      window.setTimeout(() => setTypingIndex(index), timing.typingOffsetsMs[index]),
      window.setTimeout(() => {
        setTypingIndex(-1);
        setVisibleCount(index + 1);
      }, delay),
    ]);
    timers.push(window.setTimeout(() => setComplete(true), timing.totalDurationMs));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [input.relayRun, timing]);

  return {
    activeIndex: visibleCount - 1,
    complete,
    reducedMotion,
    timing,
    typingIndex,
    visibleCount,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => readMotionPreference());

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

function readMotionPreference(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
