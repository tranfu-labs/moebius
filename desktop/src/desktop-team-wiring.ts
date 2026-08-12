import type { AgentTeamServicePorts } from "./team-ipc.js";
import type { TeamConversationPreferencePorts } from "./team-conversation-preference.js";
import type { TeamRuntimeBindingPorts } from "./team-runtime-binding.js";
import { readTeamDirectoryCreatedAt } from "./team-directory-metadata-store.js";
import {
  getPackagedTeamCacheDirectory,
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
  removeTeamExecutionBindings,
  replaceTeamExecutionBindings,
  saveTeamExecutionBinding,
} from "./team-management-store.js";
import { computeOfficialTeamContentFingerprint } from "./team-official-management.js";
import type { OfficialTeamAutoSyncService } from "./team-auto-sync.js";
import { readTeamOnboardingOrchestration } from "./team-onboarding-orchestration-store.js";
import {
  forgetTrashedUserTeamRecord,
  listRecordedUserTeamSnapshots,
  registerUserTeamSnapshot,
  resolveRecordedTeamLocation,
} from "./team-record-store.js";
import { readTeamSeedConflicts } from "./team-seed.js";
import { listSharedAgentFiles } from "./team-shared-agent-store.js";
import {
  addTeamMember,
  createUserTeam,
  duplicateBuiltInTeamDirectory,
  duplicateTeamMemberDirectory,
  duplicateUserTeamDirectory,
  listTeamLocations,
  readTeamSnapshot,
  reorderTeamMembers,
  resolveTeamLocation,
  setTeamPrimaryAgent,
  trashTeamMemberDirectory,
  trashUserTeamDirectory,
  updateTeamInformation,
  writeMemberAgentMarkdown,
  writeMemberTeamPortrait,
} from "./team-store.js";
import {
  readLastUsedAgentTeamStore,
  writeLastUsedAgentTeamStore,
} from "./team-conversation-preference-store.js";

export function createDesktopTeamRuntimeBindingPorts(): TeamRuntimeBindingPorts {
  return {
    listSharedAgents: listSharedAgentFiles,
    resolveSystemLocation: ({ dataRoot, teamId }) => resolveTeamLocation({
      dataRoot,
      teamId,
      ownership: "system",
    }),
    resolveUserLocation: resolveRecordedTeamLocation,
    readSnapshot: readTeamSnapshot,
    readBindings: readTeamExecutionBindings,
    readOfficialState: readOfficialTeamStateDocument,
  };
}

export function createDesktopAgentTeamServicePorts(): AgentTeamServicePorts & {
  attachAutoSync(service: OfficialTeamAutoSyncService): void;
} {
  let autoSync: OfficialTeamAutoSyncService | null = null;
  const emptyViews = {
    banner: null,
    recent: null,
    hasUnseen: false,
    pendingMerge: null,
  };
  const ports: AgentTeamServicePorts = {
    listLocations: listTeamLocations,
    readSnapshot: readTeamSnapshot,
    listRecorded: listRecordedUserTeamSnapshots,
    readRegistrationIssues: readTeamSeedConflicts,
    create: createUserTeam,
    resolveSystem: ({ dataRoot, teamId }) => resolveTeamLocation({
      dataRoot,
      teamId,
      ownership: "system",
    }),
    resolveUser: resolveRecordedTeamLocation,
    writeMember: writeMemberAgentMarkdown,
    writeMemberPortrait: writeMemberTeamPortrait,
    addMember: addTeamMember,
    updateInformation: updateTeamInformation,
    setPrimary: setTeamPrimaryAgent,
    reorderMembers: reorderTeamMembers,
    duplicateBuiltIn: duplicateBuiltInTeamDirectory,
    duplicateUser: duplicateUserTeamDirectory,
    duplicateMember: duplicateTeamMemberDirectory,
    trashMember: trashTeamMemberDirectory,
    trashUser: trashUserTeamDirectory,
    readBindings: readTeamExecutionBindings,
    replaceBindings: replaceTeamExecutionBindings,
    saveBinding: saveTeamExecutionBinding,
    removeBindings: removeTeamExecutionBindings,
    register: registerUserTeamSnapshot,
    forget: forgetTrashedUserTeamRecord,
    readOfficial: readOfficialTeamStateDocument,
    readSyncViews: async (input) => autoSync === null
      ? emptyViews
      : await autoSync.readTeamSyncViews(input),
    readCurrentContentFingerprint: async ({ dataRoot, teamId }) => {
      try {
        return await computeOfficialTeamContentFingerprint(resolveTeamLocation({
          dataRoot,
          teamId,
          ownership: "system",
        }).directory);
      } catch {
        return null;
      }
    },
    revertOfficialSync: async (input) => {
      if (autoSync === null) {
        throw new Error("官方同步服务尚未就绪。");
      }
      return await autoSync.revertLatestSync(input);
    },
    retryOfficialSync: async (input) => {
      if (autoSync === null) {
        throw new Error("官方同步服务尚未就绪。");
      }
      return await autoSync.runForTeam({ ...input, mode: "explicit" });
    },
    dismissOfficialSyncBanner: async (input) => {
      if (autoSync !== null) {
        await autoSync.dismissLatestSyncBanner(input);
      }
    },
    markOfficialSyncSeen: async (input) => {
      if (autoSync !== null) {
        await autoSync.markSyncSeen(input);
      }
    },
    resolveLocation: resolveTeamLocation,
    readOnboarding: readTeamOnboardingOrchestration,
    readCreatedAt: readTeamDirectoryCreatedAt,
    getPackagedDirectory: getPackagedTeamCacheDirectory,
  };
  return Object.assign(ports, {
    attachAutoSync(service: OfficialTeamAutoSyncService): void {
      autoSync = service;
    },
  });
}

export function createDesktopTeamConversationPreferencePorts(
  list: TeamConversationPreferencePorts["list"],
): TeamConversationPreferencePorts {
  return {
    read: readLastUsedAgentTeamStore,
    write: writeLastUsedAgentTeamStore,
    list,
  };
}
