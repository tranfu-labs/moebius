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

export function decideOnboardingReadinessCheckCurrent(
  model: OnboardingReadinessModel,
  cli: OnboardingCli,
  sequence: number,
): boolean {
  return model.checkSequence[cli] === sequence;
}

export function planOnboardingReadinessTransport(
  cli: OnboardingCli,
  modernAvailable: boolean,
): { kind: "modern" } | { kind: "legacy" } | { kind: "unsupported" } {
  if (modernAvailable) return { kind: "modern" };
  return cli === "codex" ? { kind: "legacy" } : { kind: "unsupported" };
}

export function planOnboardingReadinessStateLoad(
  available: boolean,
): { kind: "load" } | { kind: "skip" } {
  return available ? { kind: "load" } : { kind: "skip" };
}

export function planOnboardingReadinessCheckingView(current: {
  status: OnboardingCliReadinessSnapshot["status"];
  revision: number;
  lastKnownReady?: boolean;
}): {
  status: "checking";
  revision: number;
  lastKnownReady: boolean;
} {
  return {
    status: "checking",
    revision: current.revision + 1,
    lastKnownReady: current.status === "ready" || current.lastKnownReady === true,
  };
}

export function planOnboardingLegacyReadinessView(legacy: {
  status?: "ok" | "error";
  message?: string;
  detail?: string;
} | undefined, revision: number): {
  status: "ready" | "missing" | "unavailable";
  revision: number;
  version?: string;
} {
  if (legacy?.status === "ok") {
    return {
      status: "ready",
      revision,
      ...(legacy.detail === undefined ? {} : { version: legacy.detail }),
    };
  }
  return {
    status: legacy?.message === "Codex 未找到" ? "missing" : "unavailable", // i18n-exempt: legacy-protocol-value
    revision,
  };
}

export function planOnboardingReadinessView(snapshot: OnboardingCliReadinessSnapshot): {
  status: OnboardingCliReadinessSnapshot["status"];
  revision: number;
  code: OnboardingCliReadinessSnapshot["code"];
  version?: string;
} {
  return {
    status: snapshot.status,
    revision: snapshot.revision,
    code: snapshot.code,
    ...(snapshot.version === null ? {} : { version: snapshot.version }),
  };
}

export function planOnboardingReadinessStateResult<T>(
  state: T | undefined,
): { kind: "merge"; state: T } | { kind: "skip" } {
  return state === undefined ? { kind: "skip" } : { kind: "merge", state };
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
