export type ActivityKind =
  | "search"
  | "read"
  | "command"
  | "edit"
  | "progress";

export interface ActivityEvent {
  id: string;
  at: number;
  kind: ActivityKind;
  phase: "running" | "completed";
  action: string;
  object: string;
}

export type RunStatus =
  | "running"
  | "paused"
  | "stopped"
  | "completed"
  | "unable";

export interface Attempt {
  number: number;
  status: RunStatus;
  elapsedSeconds: number;
  completedAt?: string;
  processAvailable: boolean;
}

export interface PrototypeState {
  status: RunStatus;
  elapsedSeconds: number;
  eventIndex: number;
  activityCursor: number;
  attempts: Attempt[];
}

export type PrototypeAction =
  | { type: "advance-event" }
  | { type: "tick" }
  | { type: "stop" }
  | { type: "complete" }
  | { type: "pause" }
  | { type: "continue" }
  | { type: "recovery-failed" }
  | { type: "retry" }
  | { type: "reset" };

export const ACTIVITY_FIXTURES: ActivityEvent[] = [
  {
    id: "search-started",
    at: 10,
    kind: "search",
    phase: "running",
    action: "正在搜索代码",
    object: "“activeRun”"
  },
  {
    id: "test-started",
    at: 20,
    kind: "command",
    phase: "running",
    action: "正在运行命令",
    object: "pnpm test"
  },
  {
    id: "test-completed",
    at: 30,
    kind: "command",
    phase: "completed",
    action: "已完成命令",
    object: "pnpm test"
  },
  {
    id: "file-edited",
    at: 40,
    kind: "edit",
    phase: "running",
    action: "正在修改文件",
    object: "run-block.tsx"
  },
  {
    id: "agent-progress",
    at: 50,
    kind: "progress",
    phase: "running",
    action: "正在整理验证结果",
    object: "Agent 可见进度"
  }
];

const INITIAL_ATTEMPTS: Attempt[] = [
  {
    number: 1,
    status: "stopped",
    elapsedSeconds: 42,
    completedAt: "完成于 14:18",
    processAvailable: true
  },
  {
    number: 2,
    status: "running",
    elapsedSeconds: 84,
    processAvailable: true
  }
];

export function initialPrototypeState(): PrototypeState {
  return {
    status: "running",
    elapsedSeconds: 84,
    eventIndex: 0,
    activityCursor: ACTIVITY_FIXTURES[0]?.at ?? 0,
    attempts: INITIAL_ATTEMPTS.map((attempt) => ({ ...attempt }))
  };
}

export function prototypeReducer(
  state: PrototypeState,
  action: PrototypeAction
): PrototypeState {
  if (action.type === "reset") {
    return initialPrototypeState();
  }

  if (action.type === "advance-event") {
    if (state.status !== "running") {
      return state;
    }
    const nextIndex = Math.min(
      state.eventIndex + 1,
      ACTIVITY_FIXTURES.length - 1
    );
    const nextEvent = ACTIVITY_FIXTURES[nextIndex];
    return {
      ...state,
      eventIndex: nextIndex,
      activityCursor: Math.max(state.activityCursor, nextEvent?.at ?? 0)
    };
  }

  if (action.type === "tick") {
    if (state.status !== "running") {
      return state;
    }
    const elapsedSeconds = state.elapsedSeconds + 1;
    return updateCurrentAttempt(
      { ...state, elapsedSeconds },
      { elapsedSeconds }
    );
  }

  if (action.type === "stop") {
    return finishCurrentAttempt(state, "stopped", "完成于 14:32");
  }

  if (action.type === "complete") {
    return finishCurrentAttempt(state, "completed", "完成于 14:32");
  }

  if (action.type === "pause") {
    if (state.status !== "running") {
      return state;
    }
    return updateCurrentAttempt(
      { ...state, status: "paused" },
      { status: "paused" }
    );
  }

  if (action.type === "continue") {
    if (state.status !== "paused") {
      return state;
    }
    return updateCurrentAttempt(
      { ...state, status: "running" },
      { status: "running" }
    );
  }

  if (action.type === "recovery-failed") {
    if (state.status !== "paused") {
      return state;
    }
    return finishCurrentAttempt(state, "unable", "完成于 14:32");
  }

  if (action.type === "retry") {
    if (
      state.status !== "stopped"
      && state.status !== "unable"
      && state.status !== "completed"
    ) {
      return state;
    }
    const nextNumber =
      Math.max(...state.attempts.map((attempt) => attempt.number), 0) + 1;
    return {
      status: "running",
      elapsedSeconds: 0,
      eventIndex: 0,
      activityCursor: ACTIVITY_FIXTURES[0]?.at ?? 0,
      attempts: [
        ...state.attempts,
        {
          number: nextNumber,
          status: "running",
          elapsedSeconds: 0,
          processAvailable: true
        }
      ]
    };
  }

  return state;
}

export function currentActivity(state: PrototypeState): ActivityEvent {
  const visible = ACTIVITY_FIXTURES.filter(
    (event, index) => index <= state.eventIndex && event.at <= state.activityCursor
  );
  return visible[visible.length - 1] ?? ACTIVITY_FIXTURES[0];
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remainder)}`;
  }
  return `${pad(minutes)}:${pad(remainder)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function finishCurrentAttempt(
  state: PrototypeState,
  status: Extract<RunStatus, "stopped" | "completed" | "unable">,
  completedAt: string
): PrototypeState {
  if (state.status !== "running" && state.status !== "paused") {
    return state;
  }
  return updateCurrentAttempt(
    { ...state, status },
    { status, completedAt }
  );
}

function updateCurrentAttempt(
  state: PrototypeState,
  update: Partial<Attempt>
): PrototypeState {
  const latestNumber = Math.max(
    ...state.attempts.map((attempt) => attempt.number),
    0
  );
  return {
    ...state,
    attempts: state.attempts.map((attempt) =>
      attempt.number === latestNumber
        ? {
            ...attempt,
            elapsedSeconds: state.elapsedSeconds,
            ...update
          }
        : attempt
    )
  };
}
