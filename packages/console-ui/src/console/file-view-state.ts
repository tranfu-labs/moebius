export type FileViewMode = "preview" | "source";

export interface FileReadState<Content> {
  targetKey: string;
  generation: number;
  loading: boolean;
  content: Content | null;
}

export type FileReadEvent<Content> =
  | { type: "request-started"; targetKey: string; generation: number }
  | { type: "request-succeeded"; targetKey: string; generation: number; content: Content }
  | { type: "request-failed"; targetKey: string; generation: number; content: Content }
  | { type: "request-invalidated"; targetKey: string; generation: number };

export interface FileViewState {
  targetKey: string;
  mode: FileViewMode;
  userSelected: boolean;
}

export type FileViewEvent =
  | {
      type: "target-changed";
      targetKey: string;
      path: string;
      scope: "workspace-file" | "external-preview";
      hasExplicitLine: boolean;
      rememberedMode?: FileViewMode;
    }
  | { type: "mode-selected"; mode: FileViewMode };

export function isMarkdownFilePath(filePath: string): boolean {
  return /\.(?:md|markdown)$/iu.test(filePath);
}

export function decideInitialFileViewMode(input: {
  path: string;
  scope: "workspace-file" | "external-preview";
  hasExplicitLine: boolean;
  rememberedMode?: FileViewMode;
}): FileViewMode {
  if (input.scope !== "workspace-file" || !isMarkdownFilePath(input.path)) {
    return "source";
  }
  if (input.hasExplicitLine) {
    return input.rememberedMode ?? "source";
  }
  return input.rememberedMode ?? "preview";
}

export function reduceFileViewState(
  state: FileViewState,
  event: FileViewEvent,
): FileViewState {
  if (event.type === "mode-selected") {
    return state.mode === event.mode && state.userSelected
      ? state
      : { ...state, mode: event.mode, userSelected: true };
  }
  if (event.targetKey === state.targetKey) {
    return state;
  }
  return {
    targetKey: event.targetKey,
    mode: decideInitialFileViewMode(event),
    userSelected: event.rememberedMode !== undefined,
  };
}

export function reduceFileReadState<Content>(
  state: FileReadState<Content>,
  event: FileReadEvent<Content>,
): FileReadState<Content> {
  if (event.type === "request-started") {
    return event.generation < state.generation
      ? state
      : {
          targetKey: event.targetKey,
          generation: event.generation,
          loading: true,
          content: null,
        };
  }
  if (event.targetKey !== state.targetKey || event.generation !== state.generation) {
    return state;
  }
  if (event.type === "request-invalidated") {
    return { ...state, generation: state.generation + 1, loading: false };
  }
  return {
    ...state,
    loading: false,
    content: event.content,
  };
}
