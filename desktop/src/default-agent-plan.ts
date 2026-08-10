import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  type ExecutionProfile,
} from "./team-execution-profile.js";

/**
 * The app-wide default Agent resolves to the built-in general-assistant
 * recommendation until the user saves an explicit choice. Pure domain logic so
 * adapters (config store, summary job, IPC) never branch on the optional
 * profile themselves.
 */
export function resolveDefaultAgentProfile(document: {
  profile: ExecutionProfile | null;
}): ExecutionProfile {
  return document.profile ?? DEFAULT_TEAM_EXECUTION_PROFILE;
}
