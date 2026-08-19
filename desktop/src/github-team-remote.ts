import {
  GithubTeamTransportError,
  type GithubTeamTransport,
} from "./github-team-transport.js";
import {
  parseGithubTeamSnapshot,
  type GithubTeamRemoteFileRead,
  type GithubTeamSnapshotResult,
} from "./github-team-snapshot.js";
import { parseTeamDefinitionJson, type TeamDefinition } from "./team-model.js";

export async function loadGithubTeamSnapshot(
  transport: GithubTeamTransport,
  repository: string,
): Promise<GithubTeamSnapshotResult> {
  const metadata = (await transport.readRepository(repository)).data;
  const root = (await transport.readRepositoryContent({ repository, path: "" })).data;
  if (!Array.isArray(root)) {
    throw new Error("GitHub 团队仓库根目录返回了无效内容。");
  }

  const files: Record<string, GithubTeamRemoteFileRead> = {};
  const rootPaths = new Set(root.map((entry) => entry.path));
  files["team.json"] = rootPaths.has("team.json")
    ? await readRepositoryFile(transport, repository, "team.json", true)
    : { content: null, error: "team.json 不存在。" };

  let definition: TeamDefinition | null = null;
  if (files["team.json"]?.content !== null && files["team.json"]?.content !== undefined) {
    try {
      definition = parseTeamDefinitionJson(files["team.json"].content);
    } catch {
      definition = null;
    }
  }

  if (rootPaths.has("official.json")) {
    files["official.json"] = await readRepositoryFile(transport, repository, "official.json", true);
  }

  const memberSlugs = definition?.memberOrder ?? [];
  const memberReads = await Promise.all(memberSlugs.map(async (slug) => {
    const relativePath = `members/${slug}/AGENT.md`;
    try {
      return [relativePath, await readRepositoryFile(transport, repository, relativePath, false)] as const;
    } catch (error) {
      if (isMemberReadFatalError(error)) throw error;
      return [relativePath, { content: null, error: safeErrorMessage(error) }] as const;
    }
  }));
  for (const [relativePath, read] of memberReads) files[relativePath] = read;

  return parseGithubTeamSnapshot({
    repository: metadata,
    rootEntries: root,
    files,
  });
}

async function readRepositoryFile(
  transport: GithubTeamTransport,
  repository: string,
  relativePath: string,
  required: boolean,
): Promise<GithubTeamRemoteFileRead> {
  try {
    const response = (await transport.readRepositoryContent({ repository, path: relativePath })).data;
    if (Array.isArray(response)) {
      return { content: null, error: `${relativePath} 不是文件。` };
    }
    return { content: response.content };
  } catch (error) {
    if (required || isMemberReadFatalError(error)) throw error;
    return { content: null, error: safeErrorMessage(error) };
  }
}

function isMemberReadFatalError(error: unknown): boolean {
  return error instanceof GithubTeamTransportError
    && ["CLI_MISSING", "CLI_UNAVAILABLE", "NETWORK_UNAVAILABLE", "RATE_LIMITED"].includes(error.code);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof GithubTeamTransportError) {
    return error.message;
  }
  return "GitHub 团队数据读取失败。";
}
