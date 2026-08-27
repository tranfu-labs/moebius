import type {
  AgentFormSpec,
  OperatorMemberIdentity,
  OperatorMessage,
  Translate,
} from "@moebius/console-ui";

import { parseAgentFormMessage } from "@moebius/console-ui/console/agent-form-protocol";
import type { LocalConsoleState } from "./console-state-contract.js";

export interface AgentFormPresentation {
  spec: AgentFormSpec;
  sourceMessageId: number;
}

export interface ProjectedAgentFormMessages {
  messages: OperatorMessage[];
  agentForm: AgentFormPresentation | null;
}

export function projectAgentFormMessagesForState(
  messages: readonly OperatorMessage[],
  state: LocalConsoleState | null,
  t: Translate,
): ProjectedAgentFormMessages {
  return projectAgentFormMessages(messages, state?.memberIdentities ?? [], t);
}

/**
 * Projects the private response fence out of the timeline and keeps the newest
 * valid form available to the host. Invalid fences remain untouched, so the
 * ordinary Markdown fallback is preserved exactly as authored.
 */
export function projectAgentFormMessages(
  messages: readonly OperatorMessage[],
  memberIdentities: readonly OperatorMemberIdentity[],
  t: Translate,
): ProjectedAgentFormMessages {
  let latest: AgentFormPresentation | null = null;
  let changed = false;
  const projected: OperatorMessage[] = [];

  for (const message of messages) {
    if (
      message.speaker !== "agent"
      || (message.status !== "completed" && message.status !== "displayed")
    ) {
      projected.push(message);
      continue;
    }

    const identity = memberIdentities.find((candidate) => candidate.slug === message.role);
    const role = message.role?.trim();
    const fallbackName = identity?.displayName.trim()
      || (role === undefined || role === "" ? t("console.common.collaborator") : `@${role}`);
    const parsed = parseAgentFormMessage(message.body, {
      memberName: fallbackName,
      ...(role === undefined || role === "" ? {} : { memberSlug: role }),
    });
    if (parsed.spec === null) {
      projected.push(message);
      continue;
    }

    const spec: AgentFormSpec = {
      ...parsed.spec,
      ...(parsed.spec.memberSlug === undefined && role !== undefined && role !== ""
        ? { memberSlug: role }
        : {}),
      ...(parsed.spec.portraitId === undefined && identity?.portraitId !== undefined
        ? { portraitId: identity.portraitId }
        : {}),
      ...(parsed.spec.engine === undefined && message.runTiming?.engine !== undefined
        ? { engine: { cli: message.runTiming.engine } }
        : parsed.spec.engine === undefined && identity?.engine !== undefined
          ? { engine: identity.engine }
        : {}),
    };
    latest = { spec, sourceMessageId: message.id };

    if (parsed.body.trim() === "" && (message.attachments?.length ?? 0) === 0 && (message.processSteps?.length ?? 0) === 0) {
      changed = true;
      continue;
    }
    projected.push(parsed.body === message.body ? message : { ...message, body: parsed.body });
    changed = true;
  }

  return { messages: changed ? projected : [...messages], agentForm: latest };
}
