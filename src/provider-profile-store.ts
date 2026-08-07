import {
  normalizeProviderProfile,
  type ProviderOperation,
  type ProviderProfile,
} from "./provider-profile.js";
import { runSqliteStateCommand } from "./sqlite-state.js";

export interface ProviderProfileStore {
  listProfiles(): Promise<ProviderProfile[]>;
  getProfile(profileId: string): Promise<ProviderProfile | null>;
  putProfile(profile: ProviderProfile, expectedRevision: number | null): Promise<ProviderProfile>;
  commitProfileOperation(
    profile: ProviderProfile,
    expectedRevision: number | null,
    operation: ProviderOperation,
  ): Promise<ProviderProfile>;
  deleteProfile(profileId: string, expectedRevision: number): Promise<boolean>;
  listOperations(profileId?: string): Promise<ProviderOperation[]>;
  putOperation(operation: ProviderOperation): Promise<ProviderOperation>;
  listSessionReferences(profileId: string): Promise<import("./provider-profile.js").ProviderReference[]>;
}

export function createSqliteProviderProfileStore(input: { sqlitePath: string }): ProviderProfileStore {
  return {
    async listProfiles() {
      const profiles = await runSqliteStateCommand<ProviderProfile[]>({
        sqlitePath: input.sqlitePath,
        command: { kind: "provider-list-profiles" },
      });
      return profiles.map(normalizeProviderProfile);
    },
    async getProfile(profileId) {
      assertId(profileId);
      const profile = await runSqliteStateCommand<ProviderProfile | null>({
        sqlitePath: input.sqlitePath,
        command: { kind: "provider-get-profile", profileId },
      });
      return profile === null ? null : normalizeProviderProfile(profile);
    },
    async putProfile(profile, expectedRevision) {
      return normalizeProviderProfile(await runSqliteStateCommand<ProviderProfile>({
        sqlitePath: input.sqlitePath,
        command: {
          kind: "provider-put-profile",
          profile: normalizeProviderProfile(profile),
          expectedRevision,
        },
      }));
    },
    async commitProfileOperation(profile, expectedRevision, operation) {
      return normalizeProviderProfile(await runSqliteStateCommand<ProviderProfile>({
        sqlitePath: input.sqlitePath,
        command: {
          kind: "provider-commit-profile-operation",
          profile: normalizeProviderProfile(profile),
          expectedRevision,
          operation,
        },
      }));
    },
    async deleteProfile(profileId, expectedRevision) {
      assertId(profileId);
      return await runSqliteStateCommand<boolean>({
        sqlitePath: input.sqlitePath,
        command: { kind: "provider-delete-profile", profileId, expectedRevision },
      });
    },
    async listOperations(profileId) {
      if (profileId !== undefined) {
        assertId(profileId);
      }
      return await runSqliteStateCommand<ProviderOperation[]>({
        sqlitePath: input.sqlitePath,
        command: { kind: "provider-list-operations", ...(profileId === undefined ? {} : { profileId }) },
      });
    },
    async putOperation(operation) {
      return await runSqliteStateCommand<ProviderOperation>({
        sqlitePath: input.sqlitePath,
        command: { kind: "provider-put-operation", operation },
      });
    },
    async listSessionReferences(profileId) {
      assertId(profileId);
      return await runSqliteStateCommand<import("./provider-profile.js").ProviderReference[]>({
        sqlitePath: input.sqlitePath,
        command: { kind: "provider-list-session-references", profileId },
      });
    },
  };
}

function assertId(value: string): void {
  if (value.trim().length === 0 || value.length > 256 || /[\r\n\0]/u.test(value)) {
    throw new Error("Invalid provider profile id");
  }
}
