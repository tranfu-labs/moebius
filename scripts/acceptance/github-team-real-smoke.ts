import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { installGithubTeam } from "../../desktop/src/github-team-installation.js";
import { loadGithubTeamSnapshot } from "../../desktop/src/github-team-remote.js";
import { createGithubTeamTransport } from "../../desktop/src/github-team-transport.js";
import { readOrBuildUserTeamRecordsDocument } from "../../desktop/src/team-record-store.js";

const REPOSITORY = "tranfu-labs/moebius-team-dev-deliver";

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

  const records = await readOrBuildUserTeamRecordsDocument(dataRoot);
  const record = records.records.find((candidate) => candidate.id === installed.teamId);
  if (record?.installationSource?.provider !== "github") {
    throw new Error("installationSource is missing from the installed record");
  }
  console.log("installationSource:", JSON.stringify(record.installationSource));
  try {
    await fs.access(path.join(dataRoot, ".state", "agent-teams", "official-state-v1.json"));
    throw new Error("new GitHub installation created official-state-v1.json");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
      throw error;
    }
  }
  console.log("official-state-v1.json: absent");

  const teamsRoot = path.join(dataRoot, "teams");
  const dirs = (await fs.readdir(teamsRoot)).filter((name) => !name.startsWith("."));
  const teamDir = path.join(teamsRoot, dirs[0]!);
  console.log("team members:", (await fs.readdir(path.join(teamDir, "members"))).join(", "));
  console.log("team.json name:", JSON.parse(await fs.readFile(path.join(teamDir, "team.json"), "utf8")).name);
} finally {
  await fs.rm(dataRoot, { recursive: true, force: true });
}
