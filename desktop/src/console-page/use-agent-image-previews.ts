import type { OperatorMessage } from "@moebius/console-ui";
import { useEffect, useRef, useState } from "react";

import { createBoundedPngPreviews } from "./attachment-preview.js";
import {
  agentImageReferenceKey,
  decideAgentImagePreviewCommit,
  decideAgentImagePreviewLoad,
  decideAgentImagePreviewPump,
  planAgentImagePreviewDerivation,
  planAgentImagePreviewOutcome,
  planAgentImagePreviewRetention,
  planAgentImagePreviewRevokeAll,
  planAgentImagePreviewUrlCommit,
  planAgentImageReferenceCandidates,
  planAgentImageSourceFileName,
  type AgentImagePreviewState,
  type AgentImageReferenceCandidate,
} from "./agent-image-reference-plan.js";
import { decideAttachmentService } from "./managed-attachment-model.js";
import type { ManagedAttachmentClient } from "./managed-attachment-port.js";

/**
 * Agent local image reference preview loading (desktop application): for candidates collected from Agent messages with the existing
 * Markdown file reference semantics, calls the session image source endpoint with bounded concurrency, derives
 * thumbnails and caches object URLs; switching message sets cancels the old batch, drops late responses, and releases
 * no-longer-visible URLs. All state transition decisions delegate to domain plans.
 */
export function useAgentImagePreviews(input: {
  client: ManagedAttachmentClient;
  messages: OperatorMessage[];
  apiBase: string | null;
  capability: string | null;
}): Record<string, AgentImagePreviewState> {
  const [states, setStates] = useState<Record<string, AgentImagePreviewState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const inFlightRef = useRef(new Set<string>());
  const generationRef = useRef(0);

  useEffect(() => {
    const service = decideAttachmentService(input);
    if (service.kind === "unavailable") return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    const candidates = planAgentImageReferenceCandidates(input.messages);
    const liveKeys = new Set(candidates.map(agentImageReferenceKey));
    const retention = planAgentImagePreviewRetention(statesRef.current, liveKeys);
    for (const url of retention.revokeUrls) URL.revokeObjectURL(url);
    setStates(retention.states);

    const queue = [...candidates];
    let index = 0;
    let running = 0;
    const process = async (candidate: AgentImageReferenceCandidate): Promise<void> => {
      const key = agentImageReferenceKey(candidate);
      const loadDecision = decideAgentImagePreviewLoad({
        state: statesRef.current[key],
        inFlight: inFlightRef.current.has(key),
      });
      if (loadDecision === "skip") return;
      inFlightRef.current.add(key);
      setStates((current) => ({ ...current, [key]: { status: "loading" } }));
      try {
        const result = await input.client.loadAgentImageSource({
          apiBase: service.apiBase,
          capability: service.capability,
          sessionId: candidate.sessionId,
          path: candidate.path,
          signal: controller.signal,
        });
        const commit = decideAgentImagePreviewCommit({
          aborted: controller.signal.aborted,
          currentGeneration: generationRef.current,
          expectedGeneration: generation,
        });
        if (commit === "ignore") return;
        const outcome = planAgentImagePreviewOutcome(result);
        if (outcome.kind !== "source") {
          setStates((current) => ({ ...current, [key]: { status: outcome.kind } }));
          return;
        }
        const previews = await createBoundedPngPreviews(new File(
          [outcome.blob],
          planAgentImageSourceFileName(candidate.path),
          { type: outcome.mediaType },
        ));
        const derivationCommit = decideAgentImagePreviewCommit({
          aborted: controller.signal.aborted,
          currentGeneration: generationRef.current,
          expectedGeneration: generation,
        });
        if (derivationCommit === "ignore") return;
        const derivation = planAgentImagePreviewDerivation(previews);
        if (derivation.kind !== "ready") {
          setStates((current) => ({ ...current, [key]: { status: derivation.kind } }));
          return;
        }
        const url = URL.createObjectURL(derivation.thumbnail);
        const largeUrl = URL.createObjectURL(derivation.large);
        setStates((current) => {
          const commit = planAgentImagePreviewUrlCommit(current, key, url, largeUrl, outcome.mediaType);
          if (commit.kind === "commit") return commit.states;
          URL.revokeObjectURL(url);
          URL.revokeObjectURL(largeUrl);
          return current;
        });
      } finally {
        inFlightRef.current.delete(key);
      }
    };
    const pump = (): void => {
      while (decideAgentImagePreviewPump({ running, index, length: queue.length }) === "continue") {
        const candidate = queue[index]!;
        index += 1;
        running += 1;
        void process(candidate).catch(() => undefined).finally(() => {
          running -= 1;
          pump();
        });
      }
    };
    pump();
    return () => {
      controller.abort("messages-changed");
      inFlightRef.current.clear();
    };
  }, [input.apiBase, input.capability, input.client, input.messages]);

  useEffect(() => () => {
    for (const url of planAgentImagePreviewRevokeAll(statesRef.current)) URL.revokeObjectURL(url);
  }, []);

  return states;
}
