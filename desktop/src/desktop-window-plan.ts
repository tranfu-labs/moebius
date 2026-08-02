export function planMainWindowClose(input: {
  isQuitting: boolean;
  hasRunningInstallers: boolean;
}): "allow" | "request-shutdown" {
  return !input.isQuitting && input.hasRunningInstallers
    ? "request-shutdown"
    : "allow";
}
