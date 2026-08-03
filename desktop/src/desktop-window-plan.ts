export function planMainWindowClose(input: {
  isQuitting: boolean;
  hasRunningInstallers?: boolean;
  hasRunningTasks?: boolean;
}): "allow" | "request-shutdown" {
  return !input.isQuitting && (input.hasRunningTasks ?? input.hasRunningInstallers ?? false)
    ? "request-shutdown"
    : "allow";
}
