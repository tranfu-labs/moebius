import { useMemo } from "react";
import type {
  OperatorSubSessionViewState,
  RightSidebarTabsState,
  Translate,
} from "@moebius/console-ui";

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
import { useMessagesWithAttachmentPreviews } from "./use-message-attachment-previews.js";

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
  const messages = useMessagesWithAttachmentPreviews({
    client,
    messages: presentation.messages,
    apiBase,
    capability: attachmentCapability,
  });
  const activeSubSessionMessages = planActiveSubSessionMessages(activeSubSessionId, subSessionViews);
  const activeSubSessionMessagesWithPreviews = useMessagesWithAttachmentPreviews({
    client,
    messages: activeSubSessionMessages,
    apiBase,
    capability: attachmentCapability,
  });
  const subSessions = useMemo(
    () => planSubSessionViewsWithPreviews(
      activeSubSessionId,
      subSessionViews,
      activeSubSessionMessagesWithPreviews,
    ),
    [activeSubSessionId, activeSubSessionMessagesWithPreviews, subSessionViews],
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
    subSessionViews: subSessions,
    rightSidebarTabs: resolvedRightSidebarTabs.state,
    rightSidebarUpdatingTabIds,
    rightSidebarTabDiscriminators,
  }), [messages, presentation, resolvedRightSidebarTabs.state, rightSidebarTabDiscriminators,
    rightSidebarUpdatingTabIds, subSessions]);
}
