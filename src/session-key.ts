interface RepositoryRef {
  owner: string;
  repo: string;
}

const ISSUE_KEY_PATTERN = /^([^/]+)\/([^#]+)#([1-9]\d*)$/;

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
