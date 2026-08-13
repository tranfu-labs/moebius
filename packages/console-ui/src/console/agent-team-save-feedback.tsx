import { CheckCircle2 } from "lucide-react";

import { useI18n } from "@/i18n";

export interface AgentTeamSaveFeedbackView {
  kind: "saved" | "external-loaded";
  teamName: string;
  savedItemCount: number;
  canApplyToExistingConversation: boolean;
}

export function AgentTeamSaveFeedback({ feedback }: { feedback: AgentTeamSaveFeedbackView }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-md border border-line bg-card px-3 py-2.5 text-sm" role="status">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-pass" strokeWidth={1.5} aria-hidden="true" />
      <div>
        <p className="font-normal text-ink">
          {feedback.kind === "external-loaded"
            ? t("console.agentTeamSaveFeedback.externalLoaded", { team: feedback.teamName })
            : t("console.agentTeamSaveFeedback.saved", { team: feedback.teamName, count: feedback.savedItemCount })}
        </p>
        {feedback.canApplyToExistingConversation ? (
          <p className="mt-0.5 text-xs text-sub">{t("console.agentTeamSaveFeedback.applyBoundary")}</p>
        ) : null}
      </div>
    </div>
  );
}
