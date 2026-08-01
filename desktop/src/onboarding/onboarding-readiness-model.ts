import type {
  OnboardingCli,
  OnboardingCliReadinessSnapshot,
} from "./cli-readiness-contract.js";

interface ReadinessCursor {
  revision: number;
  status: OnboardingCliReadinessSnapshot["status"];
}

export interface OnboardingReadinessModel {
  checkSequence: Record<OnboardingCli, number>;
  accepted: Record<OnboardingCli, ReadinessCursor>;
}

export function createOnboardingReadinessModel(): OnboardingReadinessModel {
  return {
    checkSequence: { codex: 0, claude: 0, kimi: 0 },
    accepted: {
      codex: { revision: -1, status: "checking" },
      claude: { revision: -1, status: "checking" },
      kimi: { revision: -1, status: "checking" },
    },
  };
}

export function planOnboardingReadinessCheck(
  model: OnboardingReadinessModel,
  cli: OnboardingCli,
): { model: OnboardingReadinessModel; sequence: number } {
  const sequence = model.checkSequence[cli] + 1;
  return {
    sequence,
    model: {
      ...model,
      checkSequence: { ...model.checkSequence, [cli]: sequence },
    },
  };
}

export function isCurrentOnboardingReadinessCheck(
  model: OnboardingReadinessModel,
  cli: OnboardingCli,
  sequence: number,
): boolean {
  return model.checkSequence[cli] === sequence;
}

export function decideOnboardingReadinessSnapshot(
  model: OnboardingReadinessModel,
  snapshot: OnboardingCliReadinessSnapshot,
): { accepted: boolean; model: OnboardingReadinessModel } {
  const previous = model.accepted[snapshot.cli];
  const sameRevisionCanAdvance = snapshot.revision === previous.revision
    && previous.status === "checking"
    && snapshot.status !== "checking";
  const sameTerminalIsIdempotent = snapshot.revision === previous.revision
    && previous.status === snapshot.status
    && snapshot.status !== "checking";
  if (
    snapshot.revision < previous.revision
    || (
      snapshot.revision === previous.revision
      && !sameRevisionCanAdvance
      && !sameTerminalIsIdempotent
    )
  ) {
    return { accepted: false, model };
  }
  return {
    accepted: true,
    model: {
      ...model,
      accepted: {
        ...model.accepted,
        [snapshot.cli]: {
          revision: snapshot.revision,
          status: snapshot.status,
        },
      },
    },
  };
}
