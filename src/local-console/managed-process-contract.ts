export type ManagedProcessKind = "service" | "watcher" | "task";

const FORBIDDEN_SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh", "dash", "fish", "cmd", "powershell", "pwsh"]);

export type ManagedProcessReadiness =
  | { type: "tcp"; host: "127.0.0.1" | "localhost"; port: number }
  | { type: "http"; url: string }
  | { type: "stdout-pattern"; pattern: string };

export interface ManagedProcessStartRequest {
  kind: ManagedProcessKind;
  label: string;
  executable: string;
  args: string[];
  cwd: string;
  readiness?: ManagedProcessReadiness;
  endpoint?: { url: string };
}

export function admitWorkspaceSwitchTarget(input: unknown): import("./workspace-binding-plan.js").LocalWorkspaceSwitchTarget {
  if (!isRecord(input)) fail("invalid-workspace-target", "workspace target must be an object.");
  const target = input.target;
  const keys = Object.keys(input);
  if (target === "project-root" && keys.length === 1) {
    return { target: "project-root" };
  }
  if (target !== "branch" || keys.length !== 2 || !("branchName" in input)) {
    fail("invalid-workspace-target", "workspace target must be project-root or an existing branch.");
  }
  const branchName = input.branchName;
  if (
    typeof branchName !== "string"
    || branchName.length === 0
    || Buffer.byteLength(branchName) > 512
    || /[\u0000-\u001f\u007f\s]/u.test(branchName)
    || branchName.startsWith("/")
    || branchName.startsWith("\\")
    || /[;|&`$<>]/u.test(branchName)
  ) {
    fail("invalid-workspace-target", "branchName must be a bounded Git branch name, not a path or script.");
  }
  return { target: "branch", branchName };
}

export type ManagedProcessState =
  | "starting"
  | "running"
  | "ready"
  | "unhealthy"
  | "stopping"
  | "exited";

export interface ManagedProcessSummary {
  id: string;
  sessionId: string;
  workspaceRoot: string;
  kind: ManagedProcessKind;
  label: string;
  state: ManagedProcessState;
  endpoint: { url: string } | null;
  readiness: ManagedProcessReadiness | null;
  createdAt: string;
  updatedAt: string;
  wrapperPid: number | null;
  targetPid: number | null;
  exitCode: number | null;
  signal: string | null;
  acknowledged: boolean;
}

export class ManagedProcessAdmissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function admitManagedProcessStart(
  input: unknown,
  workspaceRoot: string,
): ManagedProcessStartRequest {
  if (!isRecord(input)) fail("invalid-request", "Expected a managed process start object.");
  const kind = input.kind;
  if (kind !== "service" && kind !== "watcher" && kind !== "task") {
    fail("invalid-kind", "kind must be service, watcher, or task.");
  }
  const label = requiredText(input.label, "label", 80);
  const executable = requiredText(input.executable, "executable", 512);
  if (!/^[A-Za-z0-9._+-]+$/u.test(executable)) {
    fail("invalid-executable", "executable must be a command name, not a path or shell string.");
  }
  if (FORBIDDEN_SHELL_EXECUTABLES.has(executable.toLowerCase())) {
    fail("shell-not-allowed", "managed processes may not invoke a command shell.");
  }
  if (!Array.isArray(input.args) || input.args.length > 128) {
    fail("invalid-args", "args must be an array with at most 128 items.");
  }
  const args = input.args.map((value) => {
    if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value) > 8_192) {
      fail("invalid-args", "args must contain bounded NUL-free strings.");
    }
    return value;
  });
  const cwd = requiredText(input.cwd, "cwd", 1_024);
  if (cwd === "." || cwd === "") {
    // The workspace root is the only cwd represented without a relative segment.
  } else if (cwd.startsWith("/") || cwd.split(/[\\/]/u).includes("..")) {
    fail("cwd-outside-workspace", "cwd must be workspace-relative and may not traverse upward.");
  }
  if (!workspaceRoot.startsWith("/")) fail("invalid-workspace", "workspace root must be absolute.");
  const readiness = admitReadiness(input.readiness);
  const endpoint = admitEndpoint(input.endpoint);
  return { kind, label, executable, args, cwd, readiness, endpoint };
}

export function isSettledManagedProcess(state: ManagedProcessState): boolean {
  return state === "exited";
}

export function planManagedProcessRunningCountIncrement(current: number | undefined): number {
  return (current ?? 0) + 1;
}

export function projectManagedProcessRunningCounts(
  snapshot: import("./types.js").LocalConsoleStateSnapshot,
  activeCounts: ReadonlyMap<string, number>,
): import("./types.js").LocalConsoleStateSnapshot {
  const allSessions = snapshot.projects.flatMap((project) => project.sessions);
  const byId = new Map(allSessions.map((session) => [session.sessionId, session]));
  const incrementBySession = new Map<string, number>();
  for (const [sessionId, count] of activeCounts) {
    let current = byId.get(sessionId);
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current.sessionId)) {
      visited.add(current.sessionId);
      incrementBySession.set(current.sessionId, (incrementBySession.get(current.sessionId) ?? 0) + count);
      current = byId.get(current.analysisParentSessionId ?? current.parentSessionId ?? "");
    }
  }
  const projects = snapshot.projects.map((project) => {
    const sessions = project.sessions.map((session) => ({
      ...session,
      managedRunningCount: incrementBySession.get(session.sessionId) ?? 0,
    }));
    const managedCount = project.sessions.reduce((count, session) => count + (activeCounts.get(session.sessionId) ?? 0), 0);
    return { ...project, sessions, managedRunningCount: managedCount };
  });
  const project = projects.find((candidate) => candidate.projectId === snapshot.project.projectId) ?? snapshot.project;
  const selectedSession = snapshot.selectedSession === null
    ? null
    : project.sessions.find((session) => session.sessionId === snapshot.selectedSession!.sessionId) ?? snapshot.selectedSession;
  return { ...snapshot, projects, project, selectedSession };
}

export function managedProcessArchiveScopeSessionIds(
  sessions: readonly Pick<import("./types.js").LocalConsoleSessionSummary, "sessionId" | "parentSessionId" | "analysisParentSessionId">[],
  rootSessionId: string,
): string[] {
  const result = new Set([rootSessionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions) {
      const parent = session.analysisParentSessionId ?? session.parentSessionId ?? null;
      if (parent !== null && result.has(parent) && !result.has(session.sessionId)) {
        result.add(session.sessionId);
        changed = true;
      }
    }
  }
  return [...result];
}

function admitReadiness(value: unknown): ManagedProcessReadiness | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail("invalid-readiness", "readiness must be an object.");
  if (value.type === "none") return undefined;
  if (value.type === "tcp") {
    const host = value.host;
    if (host !== "127.0.0.1" && host !== "localhost") fail("external-readiness", "TCP readiness must use loopback.");
    if (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65_535) {
      fail("invalid-readiness", "TCP readiness port is invalid.");
    }
    return { type: "tcp", host, port: value.port as number };
  }
  if (value.type === "http") return { type: "http", url: loopbackUrl(value.url, "readiness") };
  if (value.type === "stdout-pattern") {
    const pattern = requiredText(value.pattern, "stdout pattern", 256);
    return { type: "stdout-pattern", pattern };
  }
  fail("invalid-readiness", "Unsupported readiness type.");
}

function admitEndpoint(value: unknown): { url: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail("invalid-endpoint", "endpoint must be an object.");
  return { url: loopbackUrl(value.url, "endpoint") };
}

function loopbackUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 2_048) fail(`invalid-${field}`, `${field} URL is invalid.`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { fail(`invalid-${field}`, `${field} URL is invalid.`); }
  if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) {
    fail(`external-${field}`, `${field} URL must use HTTP loopback.`);
  }
  if (parsed.username !== "" || parsed.password !== "") fail(`invalid-${field}`, `${field} URL may not contain credentials.`);
  return parsed.toString();
}

function requiredText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim() === "" || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value) > maxBytes) {
    fail(`invalid-${field}`, `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function fail(code: string, message: string): never {
  throw new ManagedProcessAdmissionError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
