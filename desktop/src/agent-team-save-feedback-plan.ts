export interface AgentTeamSaveFeedbackPlan {
  kind: "saved" | "external-loaded";
  teamName: string;
  savedItemCount: number;
  canApplyToExistingConversation: boolean;
}

export function planAgentTeamSaveFeedback(input: {
  teamName: string;
  successfulItems: readonly string[];
  failedItems: readonly string[];
  source?: "save" | "external";
}): AgentTeamSaveFeedbackPlan | null {
  if (input.successfulItems.length === 0) return null;
  return {
    kind: input.source === "external" ? "external-loaded" : "saved",
    teamName: input.teamName,
    savedItemCount: input.successfulItems.length,
    canApplyToExistingConversation: true,
  };
}
