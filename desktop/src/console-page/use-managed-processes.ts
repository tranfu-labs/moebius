import type { ManagedProcessPanelController } from "@moebius/console-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ManagedProcessBrowserPort } from "./managed-process-sync-contract.js";
import {
  decideManagedProcessCommand,
  decideManagedProcessLogPolling,
  decideManagedProcessRequestCommit,
  decideManagedProcessSelection,
  managedProcessSelectionKey,
  managedProcessErrorMessage,
  planManagedProcessCommandFailure,
  planManagedProcessCommandTarget,
  planManagedProcessLogFailure,
  planManagedProcessLogCommit,
  planManagedProcessLogCursor,
  planManagedProcessLogLoading,
  planManagedProcessSelection,
  planManagedProcessVisibleState,
} from "./managed-process-sync-model.js";

export function useManagedProcesses(input: {
  apiBase: string | null;
  sessionId: string | null;
  port: ManagedProcessBrowserPort;
  openExternalLink(url: string): void;
}): ManagedProcessPanelController {
  const [state, setState] = useState<ManagedProcessPanelController["state"]>({ status: "loading", items: [] });
  const [logs, setLogs] = useState<ManagedProcessPanelController["logs"]>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingIdsRef = useRef(new Set<string>());
  const panelOpenRef = useRef(false);
  const logIdsRef = useRef(new Set<string>());
  const logsRef = useRef(logs);
  const revision = useRef(0);
  const selection = useMemo(
    () => planManagedProcessSelection(input.apiBase, input.sessionId),
    [input.apiBase, input.sessionId],
  );
  const selectionKey = managedProcessSelectionKey(selection);
  const committedSelectionKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const requestRevision = ++revision.current;
    const load = decideManagedProcessSelection(selection);
    if (load.kind === "clear") {
      committedSelectionKeyRef.current = null;
      setState({ status: "ready", items: [] });
      setLogs({});
      return;
    }
    try {
      const items = await input.port.list({ ...load.target, signal });
      if (decideManagedProcessRequestCommit(requestRevision, revision.current, signal?.aborted === true) === "commit") {
        committedSelectionKeyRef.current = selectionKey;
        setState({ status: "ready", items });
      }
    } catch (error) {
      if (decideManagedProcessRequestCommit(requestRevision, revision.current, signal?.aborted === true) === "commit") {
        committedSelectionKeyRef.current = selectionKey;
        setState((current) => ({ status: "failed", items: current.items, message: managedProcessErrorMessage(error, "Managed process list failed") }));
      }
    }
  }, [input.port, input.apiBase, input.sessionId, selection]);

  useEffect(() => {
    const controller = new AbortController();
    committedSelectionKeyRef.current = null;
    setState({ status: "loading", items: [] });
    setLogs({});
    logIdsRef.current.clear();
    void refresh(controller.signal);
    const timer = setInterval(() => { void refresh(controller.signal); }, 2_000);
    return () => { controller.abort(); clearInterval(timer); revision.current += 1; };
  }, [refresh]);

  const command = useCallback(async (id: string, kind: "stop" | "acknowledge-exited") => {
    if (decideManagedProcessCommand(selection, pendingIdsRef.current.has(id)) === "skip") return;
    pendingIdsRef.current.add(id);
    const commandRevision = revision.current;
    setPendingIds((current) => new Set(current).add(id));
    try {
      const target = planManagedProcessCommandTarget(selection, id, kind);
      if (target.kind === "unavailable") return;
      await input.port.command(target.input);
      if (decideManagedProcessRequestCommit(commandRevision, revision.current, false) === "commit") await refresh();
    } catch (error) {
      setState((current) => planManagedProcessCommandFailure({
        requestRevision: commandRevision,
        currentRevision: revision.current,
        state: current,
        message: managedProcessErrorMessage(error, "Managed process command failed"),
      }));
    } finally {
      pendingIdsRef.current.delete(id);
      setPendingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  }, [input.port, refresh, selection]);

  const readLogs = useCallback(async (id: string) => {
    const load = decideManagedProcessSelection(selection);
    if (load.kind === "clear") return;
    logIdsRef.current.add(id);
    const requestRevision = revision.current;
    const previous = logsRef.current[id];
    setLogs((current) => ({
      ...current,
      [id]: planManagedProcessLogLoading(current[id]),
    }));
    try {
      const cursor = planManagedProcessLogCursor(previous);
      const result = await input.port.readLogs({
        ...load.target,
        id,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (decideManagedProcessRequestCommit(requestRevision, revision.current, false) === "commit") {
        setLogs((current) => ({
          ...current,
          [id]: planManagedProcessLogCommit(current[id], result),
        }));
      }
    } catch (error) {
      if (decideManagedProcessRequestCommit(requestRevision, revision.current, false) === "discard") return;
      setLogs((current) => {
        const previous = current[id];
        const message = managedProcessErrorMessage(error, "Logs unavailable");
        return { ...current, [id]: planManagedProcessLogFailure(previous, message) };
      });
    }
  }, [input.port, selection]);

  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (decideManagedProcessLogPolling(panelOpenRef.current) === "skip") return;
      for (const id of logIdsRef.current) void readLogs(id);
    }, 2_000);
    return () => clearInterval(timer);
  }, [readLogs]);

  return {
    state: planManagedProcessVisibleState({
      selectionKey,
      committedSelectionKey: committedSelectionKeyRef.current,
      state,
      loading: { status: "loading", items: [] },
    }),
    logs,
    pendingIds,
    onRefresh: () => { void refresh(); },
    onOpenChange: (open) => { panelOpenRef.current = open; },
    onReadLogs: (id) => { void readLogs(id); },
    onStop: (id) => { void command(id, "stop"); },
    onAcknowledge: () => { void command("acknowledge-exited", "acknowledge-exited"); },
    onOpenEndpoint: input.openExternalLink,
  };
}
