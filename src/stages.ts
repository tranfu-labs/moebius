export type Stage = "plan-written" | "code-verified" | "in-progress";

export const ALL_STAGES = ["plan-written", "code-verified", "in-progress"] as const satisfies readonly Stage[];

const METADATA_NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const STAGE_MARKER_PATTERN = new RegExp(
  `<!--\\s*moebius\\s*:\\s*stage\\s*=\\s*(${METADATA_NAME})\\s*-->`,
  "gi",
);
const TRAILING_STAGE_MARKER_PATTERN = new RegExp(
  `<!--\\s*moebius\\s*:\\s*stage\\s*=\\s*(${METADATA_NAME})\\s*-->\\s*$`,
  "i",
);

export function isStage(value: string): value is Stage {
  return (ALL_STAGES as readonly string[]).includes(value);
}

export function parseStageMarkers(text: string, allowedStages: readonly string[] = ALL_STAGES): string[] {
  const allowed = new Set(allowedStages);
  const stages: string[] = [];

  for (const match of text.matchAll(STAGE_MARKER_PATTERN)) {
    const stage = match[1];
    if (stage !== undefined && allowed.has(stage)) {
      stages.push(stage);
    }
  }

  return stages;
}

export function parseTrailingStageMarker(text: string, allowedStages: readonly string[] = ALL_STAGES): string | null {
  const match = text.trimEnd().match(TRAILING_STAGE_MARKER_PATTERN);
  const stage = match?.[1] ?? null;
  if (stage === null || !allowedStages.includes(stage)) {
    return null;
  }
  return stage;
}
export const CEO_ORCHESTRATION_STAGE = "in-progress";
