import type { OnboardingCliInstallSnapshot } from "./cli-installer-contract.js";
import type { OnboardingCli } from "./cli-readiness-contract.js";

interface InstallationCursor {
  revision: number;
  status: OnboardingCliInstallSnapshot["status"];
}

export interface OnboardingInstallationModel {
  accepted: Record<OnboardingCli, InstallationCursor>;
}

export function createOnboardingInstallationModel(): OnboardingInstallationModel {
  return {
    accepted: {
      codex: { revision: -1, status: "idle" },
      claude: { revision: -1, status: "idle" },
      kimi: { revision: -1, status: "idle" },
    },
  };
}

export function decideOnboardingInstallationSnapshot(
  model: OnboardingInstallationModel,
  snapshot: OnboardingCliInstallSnapshot,
  options: { allowEqual?: boolean } = {},
): {
  accepted: boolean;
  becameSucceeded: boolean;
  model: OnboardingInstallationModel;
} {
  const previous = model.accepted[snapshot.cli];
  if (
    snapshot.revision < previous.revision
    || (snapshot.revision === previous.revision && options.allowEqual !== true)
  ) {
    return { accepted: false, becameSucceeded: false, model };
  }
  return {
    accepted: true,
    becameSucceeded: previous.status === "running" && snapshot.status === "succeeded",
    model: {
      accepted: {
        ...model.accepted,
        [snapshot.cli]: { revision: snapshot.revision, status: snapshot.status },
      },
    },
  };
}
