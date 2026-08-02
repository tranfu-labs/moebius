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
import {
  commitOfficialTeamUpdate,
  inspectOfficialTeamUpdate,
  prepareOfficialTeamUpdate,
} from "./team-official-update.js";
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
  resolveTeamLocation,
  setTeamPrimaryAgent,
  trashTeamMemberDirectory,
  trashUserTeamDirectory,
  updateTeamInformation,
  writeMemberAgentMarkdown,
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

export function createDesktopAgentTeamServicePorts(): AgentTeamServicePorts {
  return {
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
    addMember: addTeamMember,
    updateInformation: updateTeamInformation,
    setPrimary: setTeamPrimaryAgent,
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
    inspectUpdate: inspectOfficialTeamUpdate,
    prepareUpdate: prepareOfficialTeamUpdate,
    commitUpdate: commitOfficialTeamUpdate,
    resolveLocation: resolveTeamLocation,
    readOnboarding: readTeamOnboardingOrchestration,
    readCreatedAt: readTeamDirectoryCreatedAt,
    getPackagedDirectory: getPackagedTeamCacheDirectory,
  };
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
