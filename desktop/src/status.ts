import type { DoctorCheck } from "./env-doctor.js";
import type { ShellPathResult } from "./shell-path.js";
import type { UpdateDecision } from "./updater.js";

export interface DesktopStatusSnapshot {
  appVersion: string;
  dataRoot: string;
  localConsole: {
    status: "starting" | "running" | "error" | "stopped";
    url?: string;
    sqlitePath?: string;
    error?: string;
  };
  doctor: { codex: DoctorCheck } | null;
  shellPath: ShellPathResult | null;
  seed: {
    status: "pending" | "ok" | "error";
    copied: number;
    skipped: number;
    error?: string;
  };
  update: UpdateDecision | null;
}
