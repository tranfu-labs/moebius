import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export type InstallerProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type InstallerProcessTerminator = (
  child: ChildProcess,
  signal: NodeJS.Signals,
) => void;

export const spawnInstallerProcess: InstallerProcessSpawner = (command, args, options) =>
  spawn(command, [...args], options);

export function waitForSuccessfulInstallerClose(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      child.off("error", onError);
      child.off("close", onClose);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onError = (): void => finish(new Error("trusted installer failed to start"));
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (code === 0) {
        finish();
      } else {
        finish(new Error(signal === null ? "trusted installer failed" : "trusted installer stopped"));
      }
    };
    child.once("error", onError);
    child.once("close", onClose);
  });
}

export const terminateInstallerProcess: InstallerProcessTerminator = (child, signal) => {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the task snapshot and the signal.
    }
  }
  child.kill(signal);
};
