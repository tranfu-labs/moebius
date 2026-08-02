import { useCallback, useMemo, type MutableRefObject } from "react";
import type { RightSidebarTabsState } from "@moebius/console-ui";

import type { ConsoleNavigationScene } from "./console-state-action-contract.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConversationComposerDraftState } from "./conversation-draft-model.js";
import type { ConversationReadingPositionStore } from "./conversation-reading-position.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import {
  planNavigationSceneHostSessionId,
  planNavigationSceneRestore,
  planNavigationSceneSnapshot,
} from "./console-state-plan.js";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import type { RightSidebarTabsBundle } from "./use-right-sidebar-tabs.js";

export function useConsoleNavigationScene(input: {
  selectionRef: MutableRefObject<ConsoleSelection>;
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>;
  rightSidebarTabs: RightSidebarTabsState;
  rightSidebarTabsBundle: Pick<RightSidebarTabsBundle, "visibilityPreference" | "showHost" | "setOpen">;
  rightSidebarTabsStore: RightSidebarTabsStore;
  composerDraftRef: MutableRefObject<ConversationComposerDraftState>;
  readingPositionStoreRef: MutableRefObject<ConversationReadingPositionStore>;
  commitSelection: (selection: ConsoleSelection) => void;
  commitPresentationRoute: (route: ConsolePresentationRoute | null) => void;
  commitComposerDraft: (draft: ConversationComposerDraftState) => void;
}): {
  captureNavigationScene: () => ConsoleNavigationScene;
  restoreNavigationScene: (scene: ConsoleNavigationScene) => void;
} {
  const {
    selectionRef,
    presentationRouteRef,
    rightSidebarTabs,
    rightSidebarTabsBundle,
    rightSidebarTabsStore,
    composerDraftRef,
    readingPositionStoreRef,
    commitSelection,
    commitPresentationRoute,
    commitComposerDraft,
  } = input;
  const { visibilityPreference, showHost, setOpen } = rightSidebarTabsBundle;
  const captureNavigationScene = useCallback((): ConsoleNavigationScene => {
    const currentSelection = selectionRef.current;
    const currentRoute = presentationRouteRef.current;
    const tabsSnapshot = rightSidebarTabsStore.snapshot?.();
    return planNavigationSceneSnapshot({
      selection: currentSelection,
      presentationRoute: currentRoute,
      hostSessionId: planNavigationSceneHostSessionId(currentRoute, currentSelection),
      tabs: rightSidebarTabs,
      visibilityPreference,
      tabsStore: tabsSnapshot,
      composer: composerDraftRef.current,
      readingPosition: {
        sessionId: currentSelection.sessionId,
        messageId: readingPositionStoreRef.current.read(currentSelection.sessionId),
      },
    });
  }, [composerDraftRef, presentationRouteRef, readingPositionStoreRef, rightSidebarTabs,
    rightSidebarTabsStore, selectionRef, visibilityPreference]);

  const restoreNavigationScene = useCallback((scene: ConsoleNavigationScene): void => {
    const restoration = planNavigationSceneRestore(
      scene,
      rightSidebarTabsStore.restore !== undefined,
    );
    commitSelection(scene.selection);
    commitPresentationRoute(scene.presentationRoute);
    if (restoration.sidebar.kind === "snapshot") {
      rightSidebarTabsStore.restore!(restoration.sidebar.snapshot);
    } else {
      rightSidebarTabsStore.write(restoration.sidebar.hostSessionId, restoration.sidebar.tabs);
    }
    showHost(scene.rightSidebar.hostSessionId);
    setOpen(scene.rightSidebar.visibilityPreference === "open");
    commitComposerDraft(scene.composer);
    if (restoration.readingPosition.kind === "remove") {
      readingPositionStoreRef.current.remove(restoration.readingPosition.sessionId);
    } else {
      readingPositionStoreRef.current.write(
        restoration.readingPosition.sessionId,
        restoration.readingPosition.messageId,
      );
    }
  }, [commitComposerDraft, commitPresentationRoute, commitSelection, readingPositionStoreRef,
    rightSidebarTabsStore, setOpen, showHost]);

  return useMemo(() => ({ captureNavigationScene, restoreNavigationScene }), [
    captureNavigationScene,
    restoreNavigationScene,
  ]);
}
