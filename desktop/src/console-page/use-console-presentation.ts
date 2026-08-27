import { useMemo } from "react";
import type {
  OperatorMessage,
  OperatorSubSessionViewState,
  RightSidebarTabsState,
  Translate,
} from "@moebius/console-ui";

import { planAgentMessageImageAttachments } from "./agent-image-reference-plan.js";
import type { LocalConsoleState } from "./console-state-contract.js";
import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import {
  planActiveSubSessionMessages,
  planCanonicalConversationTabTitles,
  planConsolePresentationState,
  planConversationTabDiscriminators,
  planSubSessionViewsWithPreviews,
  planUpdatingConversationTabIds,
} from "./console-presentation-model.js";
import { projectAgentFormMessagesForState } from "./agent-form-presentation.js";
import { useAgentImagePreviews } from "./use-agent-image-previews.js";
import { useMessagesWithAttachmentPreviews } from "./use-message-attachment-previews.js";

function withAgentImageAttachments(
  messages: OperatorMessage[],
  states: ReturnType<typeof useAgentImagePreviews>,
): OperatorMessage[] {
  return planAgentMessageImageAttachments(messages, states) as OperatorMessage[];
}

export function useConsolePresentation(
  state: LocalConsoleState | null,
  clientError: string | null,
  activeSubSessionId: string | null,
  subSessionViews: Readonly<Record<string, OperatorSubSessionViewState>>,
  rightSidebarTabs: RightSidebarTabsState,
  updatingConversationTitleSessionIds: ReadonlySet<string>,
  client: ManagedAttachmentClient,
  apiBase: string | null,
  attachmentCapability: string | null,
  t: Translate,
) {
  const presentation = planConsolePresentationState(state, clientError);
  const projectedAgentForm = useMemo(
    () => projectAgentFormMessagesForState(presentation.messages, state, t),
    [presentation.messages, state, t],
  );
  const attachmentPreviews = useMessagesWithAttachmentPreviews({
    client,
    messages: projectedAgentForm.messages,
    apiBase,
    capability: attachmentCapability,
  });
  const agentPreviews = useAgentImagePreviews({
    client,
    messages: attachmentPreviews,
    apiBase,
    capability: attachmentCapability,
  });
  const messages = useMemo(
    () => withAgentImageAttachments(attachmentPreviews, agentPreviews),
    [agentPreviews, attachmentPreviews],
  );
  const activeSubSessionMessages = planActiveSubSessionMessages(activeSubSessionId, subSessionViews);
  const activeSubSessionMessagesWithPreviews = useMessagesWithAttachmentPreviews({
    client,
    messages: activeSubSessionMessages,
    apiBase,
    capability: attachmentCapability,
  });
  const activeSubSessionAgentPreviews = useAgentImagePreviews({
    client,
    messages: activeSubSessionMessagesWithPreviews,
    apiBase,
    capability: attachmentCapability,
  });
  const activeSubSessionMessagesWithImages = useMemo(
    () => withAgentImageAttachments(activeSubSessionMessagesWithPreviews, activeSubSessionAgentPreviews),
    [activeSubSessionAgentPreviews, activeSubSessionMessagesWithPreviews],
  );
  const subSessions = useMemo(
    () => planSubSessionViewsWithPreviews(
      activeSubSessionId,
      subSessionViews,
      activeSubSessionMessagesWithImages,
    ),
    [activeSubSessionId, activeSubSessionMessagesWithImages, subSessionViews],
  );
  const resolvedRightSidebarTabs = useMemo(
    () => planCanonicalConversationTabTitles(rightSidebarTabs, presentation.projects),
    [presentation.projects, rightSidebarTabs],
  );
  const rightSidebarUpdatingTabIds = useMemo(
    () => planUpdatingConversationTabIds(
      resolvedRightSidebarTabs,
      updatingConversationTitleSessionIds,
    ),
    [resolvedRightSidebarTabs, updatingConversationTitleSessionIds],
  );
  const rightSidebarTabDiscriminators = useMemo(
    () => planConversationTabDiscriminators(
      resolvedRightSidebarTabs.state,
      presentation.projects,
      new Set(rightSidebarUpdatingTabIds),
      {
        fallback: t("console.rightSidebar.conversationDiscriminatorFallback"),
        sameMomentIndex: (index) => t("console.rightSidebar.sameMomentIndex", { index }),
      },
    ),
    [presentation.projects, resolvedRightSidebarTabs.state, rightSidebarUpdatingTabIds, t],
  );
  return useMemo(() => ({
    ...presentation,
    messages,
    agentForm: projectedAgentForm.agentForm,
    subSessionViews: subSessions,
    rightSidebarTabs: resolvedRightSidebarTabs.state,
    rightSidebarUpdatingTabIds,
    rightSidebarTabDiscriminators,
  }), [messages, presentation, projectedAgentForm.agentForm, resolvedRightSidebarTabs.state,
    rightSidebarTabDiscriminators, rightSidebarUpdatingTabIds, subSessions]);
}
