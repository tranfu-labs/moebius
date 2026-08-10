import fs from "node:fs/promises";
import path from "node:path";

import type { AgentRevisionStore } from "./agent-revision-store.js";
import type { DefaultAgentConfigStore } from "./default-agent-config-store.js";
import { resolveDefaultAgentProfile } from "./default-agent-plan.js";
import type { ExecutionProfile } from "./team-execution-profile.js";

/**
 * One-shot completion port over the existing provider drivers. Codex/Claude/Kimi
 * `run()`/`runClaude()`/`runKimiAcp()` and the Pi adapter are single-run
 * invocations already (a full run with a prompt, no session lifecycle on the
 * Moebius side); the wiring maps the default Agent's profile onto the matching
 * driver. This port is what keeps the summary job free of provider internals.
 */
export interface AgentRevisionOneShotPort {
  run(input: {
    profile: ExecutionProfile;
    prompt: string;
    runDir: string;
  }): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
}

export interface AgentRevisionSummaryJobInput {
  revisionId: string;
  teamStableId: string;
  memberSlug: string;
  previousContent: string | null;
  content: string;
}

export type AgentRevisionSummaryJob = (input: AgentRevisionSummaryJobInput) => Promise<void>;

export interface AgentRevisionSummarySettled {
  revisionId: string;
  teamStableId: string;
  memberSlug: string;
  /** Revision timestamp from the durable update; absent on the store-failure path. */
  createdAt?: string;
}

const DEFAULT_MAX_SUMMARY_LENGTH = 240;

/**
 * Reads the app-wide default Agent, performs ONE provider invocation in an
 * isolated run directory (never the user's project or team folders, never a
 * session/run lifecycle entry) and writes a plain-language one-line summary
 * back to the revision. Any failure (no default Agent, provider error, empty
 * result) downgrades the revision to `unavailable`; there is no retry storm and
 * the save feedback is never blocked by this job. `onSettled` fires once the
 * terminal state is durable so the main process can push a completion event to
 * the renderer (the view then refreshes the member in place, without polling).
 */
export function createAgentRevisionSummaryJob(input: {
  store: Pick<AgentRevisionStore, "getRevision" | "updateSummary">;
  configStore: Pick<DefaultAgentConfigStore, "read">;
  oneShot: AgentRevisionOneShotPort;
  runDirRoot: string;
  maxSummaryLength?: number;
  onSettled?: (settled: AgentRevisionSummarySettled) => void;
}): AgentRevisionSummaryJob {
  const maxSummaryLength = input.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH;
  return async function runSummaryJob(revisionInput: AgentRevisionSummaryJobInput): Promise<void> {
    const runDir = path.join(input.runDirRoot, revisionInput.revisionId);
    const settled: AgentRevisionSummarySettled = {
      revisionId: revisionInput.revisionId,
      teamStableId: revisionInput.teamStableId,
      memberSlug: revisionInput.memberSlug,
    };
    const notifySettled = (revision: { createdAt: string } | null | undefined): void => {
      input.onSettled?.(revision === null || revision === undefined
        ? settled
        : { ...settled, createdAt: revision.createdAt });
    };
    try {
      const document = await input.configStore.read();
      const profile = resolveDefaultAgentProfile(document);
      await fs.mkdir(runDir, { recursive: true });
      const result = await input.oneShot.run({
        profile,
        prompt: buildSummaryPrompt(revisionInput),
        runDir,
      });
      if (!result.ok) {
        notifySettled(await input.store.updateSummary(revisionInput.revisionId, null, "unavailable"));
        return;
      }
      const summary = summarizeResultText(result.text, maxSummaryLength);
      if (summary.length === 0) {
        notifySettled(await input.store.updateSummary(revisionInput.revisionId, null, "unavailable"));
        return;
      }
      notifySettled(await input.store.updateSummary(revisionInput.revisionId, summary, "ready"));
    } catch {
      // The revision itself is already durable; a failed summary must never
      // surface as a save failure or trigger retries.
      const revision = await input.store.updateSummary(revisionInput.revisionId, null, "unavailable")
        .catch(() => null);
      notifySettled(revision);
    }
  };
}

export function buildSummaryPrompt(input: AgentRevisionSummaryJobInput): string {
  const previous = input.previousContent === null
    ? "（没有更早的记录，这是这份文档的第一次修订）"
    : input.previousContent;
  return [
    "你是 Moebius 里一名成员规则文档（AGENT.md）的维护助手。",
    "下面给出了「修改前」和「修改后」的完整文档。请用一句日常语言说明这次改了什么，",
    "像向同事解释一样自然，不超过 40 个字。只输出那一句话本身，不要引号、不要标题、",
    "不要任何额外解释。如果修改前为空说明这是第一次修订，就概括这份文档的用途。",
    "",
    "修改前：",
    "---",
    previous,
    "---",
    "",
    "修改后：",
    "---",
    input.content,
    "---",
  ].join("\n");
}

export function summarizeResultText(text: string, maxLength: number): string {
  const collapsed = text.trim().replace(/\s+/gu, " ");
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}…`;
}
