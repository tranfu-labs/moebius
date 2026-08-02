import type {
  OperatorEvidenceOpenIntent,
  OperatorEvidenceView,
  Translate,
  TranslationKey,
} from "@moebius/console-ui";
import {
  decideEvidenceIntent,
  planConsoleEndpoint,
  planEvidenceContent,
  planEvidenceMember,
  planEvidenceRecord,
  planEvidenceResponse,
  planLabeledEvidenceOutput,
  planWorkspaceEvidenceContent,
} from "./console-state-plan.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function loadEvidenceView(options: {
  apiBase: string;
  intent: OperatorEvidenceOpenIntent;
  fetch: FetchLike;
  t: Translate;
}): Promise<OperatorEvidenceView> {
  const intentDecision = decideEvidenceIntent(options.intent.kind);
  if (intentDecision === "workspace-diff") {
    const intent = options.intent as Extract<OperatorEvidenceOpenIntent, { kind: "workspace-diff" }>;
    return {
      kind: "workspace-diff",
      title: options.t("desktop.evidence.workspaceDiffTitle"),
      content: planWorkspaceEvidenceContent({
        fileCount: intent.fileCount,
        emptyText: options.t("desktop.evidence.noWorkspaceChanges"),
        changedText: options.t("desktop.evidence.workspaceChangeCount", { count: intent.fileCount }),
      }),
    };
  }

  const intent = options.intent as Extract<OperatorEvidenceOpenIntent, { kind: "run-output" }>;
  const fetch = options.fetch;
  const response = await fetch(planConsoleEndpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(intent.sessionId)}/runs/${encodeURIComponent(intent.runId)}/output`,
  ));
  const body = await response.json() as {
    stdout?: string | null;
    stderr?: string | null;
    fallback?: string | null;
    error?: string;
  };
  const responsePlan = planEvidenceResponse(response.ok, body);
  if (responsePlan.kind === "rejected") {
    throw new Error(responsePlan.message);
  }
  const memberPlan = planEvidenceMember(intent.role);
  const member = memberPlan.kind === "literal"
    ? memberPlan.value
    : options.t(memberPlan.key as TranslationKey);
  const content = planEvidenceContent({
    stdout: planLabeledEvidenceOutput(options.t("desktop.evidence.stdout"), responsePlan.body.stdout),
    stderr: planLabeledEvidenceOutput(options.t("desktop.evidence.stderr"), responsePlan.body.stderr),
    record: planLabeledEvidenceOutput(
      options.t("desktop.evidence.record"),
      planEvidenceRecord(responsePlan.body.fallback, intent.fallbackOutput),
    ),
    emptyText: options.t("desktop.evidence.noOutput"),
  });
  return {
    kind: "run-output",
    title: options.t("desktop.evidence.fullOutputTitle", {
      member,
    }),
    content,
  };
}

