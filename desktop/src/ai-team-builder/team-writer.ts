import {
  evaluateTeamStatus,
  parseAgentMarkdownIdentity,
  parseTeamDefinitionJson,
  serializeTeamDefinition,
} from "../team-model.js";
import type { TeamSnapshot } from "../team-store.js";
import {
  TEAM_ONBOARDING_ORCHESTRATION_FILE,
  parseTeamOnboardingOrchestrationJson,
  serializeTeamOnboardingOrchestration,
} from "../team-onboarding-orchestration.js";
import type { AiTeamBuilderProposal } from "./validator.js";
import type { AiTeamWriteStorePort } from "./team-write-contract.js";
import { AiTeamWriterError } from "./team-write-error.js";
import {
  decideAiTeamWriteDevice,
  planAiTeamStagedValidation,
  planAiTeamWrite,
  planAiTeamWriteCleanup,
  planAiTeamWriteError,
} from "./team-write-plan.js";

export { AiTeamWriterError } from "./team-write-error.js";

export interface AiTeamWriterResult {
  teamId: string;
  snapshot: TeamSnapshot;
}

export interface AiTeamWriterOptions {
  store: AiTeamWriteStorePort;
  register: (snapshot: TeamSnapshot) => Promise<void>;
  rollbackRecord: (input: { dataRoot: string; teamId: string }) => Promise<void>;
  createId: () => string;
}

export class AiTeamWriter {
  constructor(private readonly options: AiTeamWriterOptions) {}

  async create(dataRoot: string, proposal: AiTeamBuilderProposal): Promise<AiTeamWriterResult> {
    const writePlan = planAiTeamWrite(proposal, this.options.createId());
    if (!writePlan.ok) {
      throw new AiTeamWriterError("The current AI team proposal is invalid.");
    }
    const locations = await this.options.store.prepare(dataRoot, writePlan.teamId);
    const deviceDecision = decideAiTeamWriteDevice(
      locations.teamsDevice,
      locations.stagingDevice,
    );
    if (!deviceDecision.ok) {
      throw new AiTeamWriterError(deviceDecision.message);
    }

    let renamed = false;
    let staging: string | null = null;
    try {
      const readback = await this.options.store.stage(locations, {
        definitionSource: serializeTeamDefinition(writePlan.definition),
        orchestrationFileName: TEAM_ONBOARDING_ORCHESTRATION_FILE,
        orchestrationSource: serializeTeamOnboardingOrchestration(writePlan.orchestration),
        members: writePlan.members,
      });
      staging = readback.staging;
      const definition = parseTeamDefinitionJson(readback.definitionSource);
      const orchestration = parseTeamOnboardingOrchestrationJson(
        readback.orchestrationSource,
        definition.memberOrder,
      );
      const validation = planAiTeamStagedValidation({
        proposal,
        definition,
        orchestration,
        members: readback.members.map((member) => ({
          slug: member.slug,
          identity: parseAgentMarkdownIdentity(member.agentMarkdown),
          agentMarkdown: member.agentMarkdown,
        })),
      });
      if (!validation.ok) {
        throw new AiTeamWriterError(validation.message);
      }
      const readiness = evaluateTeamStatus({ definition });
      const stagedSnapshot: TeamSnapshot = {
        location: {
          dataRoot: locations.dataRoot,
          id: locations.teamId,
          directory: readback.staging,
          ownership: "user",
        },
        definition,
        members: readback.members.map((member) => ({
          ...member,
          ...parseAgentMarkdownIdentity(member.agentMarkdown),
        })),
        status: readiness.status,
        canCreateConversation: readiness.canCreateConversation,
        issues: readiness.issues,
      };
      await this.options.store.commit(readback.staging, readback.destination);
      renamed = true;
      const snapshot = this.options.store.relocateSnapshot(
        stagedSnapshot,
        readback.destination,
      );
      try {
        await this.options.register(snapshot);
      } catch (error) {
        await this.options.rollbackRecord({ dataRoot: locations.dataRoot, teamId: locations.teamId });
        throw error;
      }
      return { teamId: locations.teamId, snapshot };
    } catch (error) {
      const cleanup = planAiTeamWriteCleanup({
        renamed,
        staging,
        destination: locations.destination,
      });
      if (cleanup.kind === "remove") {
        await this.options.store.remove(cleanup.target);
      }
      throw planAiTeamWriteError(error);
    }
  }
}
