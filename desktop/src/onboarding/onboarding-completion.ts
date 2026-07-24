export type OnboardingPresentationCompletion =
  | {
      mode: "first-run";
      teamKey: string;
      onFirstRunComplete: (teamKey: string) => void | Promise<void>;
    }
  | {
      mode: "replay";
      onReplayComplete: () => void | Promise<void>;
    };

export async function finishOnboardingPresentation(
  completion: OnboardingPresentationCompletion,
): Promise<void> {
  if (completion.mode === "replay") {
    await completion.onReplayComplete();
    return;
  }
  await completion.onFirstRunComplete(completion.teamKey);
}
