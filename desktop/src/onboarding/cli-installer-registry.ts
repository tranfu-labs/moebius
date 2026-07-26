import type { OnboardingCli } from "./cli-readiness-contract.js";

export interface TrustedInstallerCommand {
  command: string;
  args: readonly string[];
}

export type TrustedCliInstaller =
  | {
      cli: "codex";
      kind: "command";
      displayCommand: string;
      command: TrustedInstallerCommand;
    }
  | {
      cli: "kimi";
      kind: "pipeline";
      displayCommand: string;
      source: TrustedInstallerCommand;
      destination: TrustedInstallerCommand;
    };

const INSTALLERS: Readonly<Record<OnboardingCli, TrustedCliInstaller>> = Object.freeze({
  codex: Object.freeze({
    cli: "codex",
    kind: "command",
    displayCommand: "npm install -g @openai/codex",
    command: Object.freeze({
      command: "npm",
      args: Object.freeze(["install", "-g", "@openai/codex"]),
    }),
  }),
  kimi: Object.freeze({
    cli: "kimi",
    kind: "pipeline",
    displayCommand: "curl -LsSf https://code.kimi.com/install.sh | bash",
    source: Object.freeze({
      command: "curl",
      args: Object.freeze(["-LsSf", "https://code.kimi.com/install.sh"]),
    }),
    destination: Object.freeze({
      command: "bash",
      args: Object.freeze(["-s", "--"]),
    }),
  }),
});

export function getTrustedCliInstaller(cli: OnboardingCli): TrustedCliInstaller {
  return INSTALLERS[cli];
}
