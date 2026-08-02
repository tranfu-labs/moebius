interface RepositoryRef {
  owner: string;
  repo: string;
}

const GITHUB_SESSION_PREFIX = "github:";
const ISSUE_KEY_PATTERN = /^([^/]+)\/([^#]+)#([1-9]\d*)$/;

export function makeGitHubSessionId(input: RepositoryRef & { issueNumber: number }): string {
  return `${GITHUB_SESSION_PREFIX}${input.owner}/${input.repo}#${String(input.issueNumber)}`;
}

export function issueKeyToSessionId(key: string): string {
  const parsed = parseIssueKey(key);
  if (parsed === null) {
    return key;
  }
  return makeGitHubSessionId(parsed);
}

export function sessionIdToIssueKey(sessionId: string): string {
  if (!sessionId.startsWith(GITHUB_SESSION_PREFIX)) {
    return sessionId;
  }
  return sessionId.slice(GITHUB_SESSION_PREFIX.length);
}

export function parseIssueKey(key: string): (RepositoryRef & { issueNumber: number }) | null {
  const match = ISSUE_KEY_PATTERN.exec(key);
  if (match === null) {
    return null;
  }
  const [, owner, repo, issueNumber] = match;
  if (owner === undefined || repo === undefined || issueNumber === undefined) {
    return null;
  }
  return { owner, repo, issueNumber: Number(issueNumber) };
}
