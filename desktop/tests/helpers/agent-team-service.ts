import { readTeamDirectoryCreatedAt } from "../../src/team-directory-metadata-store.js";
import { createAgentTeamService } from "../../src/team-ipc.js";
import {
  getPackagedTeamCacheDirectory,
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
  removeTeamExecutionBindings,
  replaceTeamExecutionBindings,
  saveTeamExecutionBinding,
} from "../../src/team-management-store.js";
import { readTeamOnboardingOrchestration } from "../../src/team-onboarding-orchestration-store.js";
import {
  commitOfficialTeamUpdate,
  inspectOfficialTeamUpdate,
  prepareOfficialTeamUpdate,
} from "../../src/team-official-update.js";
import {
  forgetTrashedUserTeamRecord,
  listRecordedUserTeamSnapshots,
  registerUserTeamSnapshot,
  resolveRecordedTeamLocation,
} from "../../src/team-record-store.js";
import { readTeamSeedConflicts } from "../../src/team-seed.js";
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
} from "../../src/team-store.js";

export function createTestAgentTeamService() {
  return createAgentTeamService({
    listLocations: listTeamLocations,
    readSnapshot: readTeamSnapshot,
    listRecorded: listRecordedUserTeamSnapshots,
    readRegistrationIssues: readTeamSeedConflicts,
    create: createUserTeam,
    resolveSystem: ({ dataRoot, teamId }) => resolveTeamLocation({ dataRoot, teamId, ownership: "system" }),
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
  });
}
