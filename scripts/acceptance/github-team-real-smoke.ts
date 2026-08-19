import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentRevisionService } from "../../desktop/src/agent-revision-service.js";
import { installGithubTeam } from "../../desktop/src/github-team-installation.js";
import { loadGithubTeamSnapshot } from "../../desktop/src/github-team-remote.js";
import {
  revertGithubTeamSync,
  syncGithubTeamUpstream,
} from "../../desktop/src/github-team-sync-execute.js";
import { checkGithubTeamUpstream } from "../../desktop/src/github-team-sync-check.js";
import { createGithubTeamTransport } from "../../desktop/src/github-team-transport.js";
import type { DefaultAgentMergeMember } from "../../desktop/src/team-auto-sync.js";

const REPOSITORY = "tranfu-labs/moebius-team-dev-deliver";

const mergeMember: DefaultAgentMergeMember = (async () => ({ ok: false })) as DefaultAgentMergeMember;
const revisionService = {
  recordMemberRevision: async () => ({}),
} as unknown as Pick<AgentRevisionService, "recordMemberRevision">;

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-real-smoke-"));
const transport = createGithubTeamTransport();

try {
  const snapshot = await loadGithubTeamSnapshot(transport, REPOSITORY);
  if (snapshot.status !== "ready") {
    throw new Error(`snapshot not ready: ${JSON.stringify(snapshot.issues)}`);
  }
  console.log("snapshot: ready");
  console.log("  name:", snapshot.snapshot.repository.name);
  console.log("  members:", snapshot.snapshot.definition.memberOrder.join(", "));
  console.log("  recommendations:", Object.keys(snapshot.snapshot.recommendations).join(", "));

  const installed = await installGithubTeam({ dataRoot, snapshot: snapshot.snapshot });
  if (installed.status !== "installed") {
    throw new Error(`install failed: ${installed.status}`);
  }
  console.log("install: installed", installed.teamId);

  const check = await checkGithubTeamUpstream({ dataRoot, teamId: installed.teamId, transport });
  console.log("checkUpstream:", JSON.stringify(check));

  const sync = await syncGithubTeamUpstream({
    dataRoot,
    teamId: installed.teamId,
    transport,
    mergeMember,
    revisionService,
  });
  console.log("sync:", JSON.stringify(sync));

  const revert = await revertGithubTeamSync({ dataRoot, teamId: installed.teamId, revisionService });
  console.log("revertSync:", JSON.stringify(revert));

  const teamsRoot = path.join(dataRoot, "teams");
  const dirs = (await fs.readdir(teamsRoot)).filter((name) => !name.startsWith("."));
  const teamDir = path.join(teamsRoot, dirs[0]!);
  console.log("team members:", (await fs.readdir(path.join(teamDir, "members"))).join(", "));
  console.log("team.json name:", JSON.parse(await fs.readFile(path.join(teamDir, "team.json"), "utf8")).name);
} finally {
  await fs.rm(dataRoot, { recursive: true, force: true });
}
