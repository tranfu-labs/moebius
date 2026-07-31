import type { LocalConsoleExecutionProfile } from "./local-console/types.js";

export interface TrustedExecutionModel {
  value: string;
  label: string;
  efforts: readonly string[];
  defaultEffort: string;
  membershipRestricted: boolean;
}

export type TrustedExecutionRegistry = Readonly<Record<
  LocalConsoleExecutionProfile["cli"],
  readonly TrustedExecutionModel[]
>>;

export const TRUSTED_EXECUTION_REGISTRY: TrustedExecutionRegistry = {
  codex: [
    model("gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]),
    model("gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]),
    model("gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]),
    model("gpt-5.5", ["low", "medium", "high", "xhigh"]),
    model("gpt-5.4", ["low", "medium", "high", "xhigh"]),
    model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
  ],
  claude: [
    model("fable", ["low", "medium", "high", "xhigh", "max"]),
    model("sonnet", ["low", "medium", "high", "max"]),
    model("opus", ["low", "medium", "high", "max"]),
  ],
  kimi: [
    model("kimi-code/kimi-for-coding", ["on"], {
      label: "kimi-for-coding",
      defaultEffort: "on",
    }),
    model("kimi-code/k3", ["low", "high", "max"], {
      label: "k3",
      membershipRestricted: true,
    }),
    model("kimi-code/k3-256k", ["low", "high", "max"], {
      label: "k3-256k",
      membershipRestricted: true,
    }),
    model("kimi-code/kimi-for-coding-highspeed", ["on"], {
      label: "kimi-for-coding-highspeed",
      defaultEffort: "on",
      membershipRestricted: true,
    }),
  ],
};

export function isTrustedExecutionProfile(
  value: LocalConsoleExecutionProfile,
): boolean {
  return TRUSTED_EXECUTION_REGISTRY[value.cli].some((candidate) =>
    candidate.value === value.model && candidate.efforts.includes(value.effort));
}

function model(
  value: string,
  efforts: readonly string[],
  options: {
    label?: string;
    defaultEffort?: string;
    membershipRestricted?: boolean;
  } = {},
): TrustedExecutionModel {
  return {
    value,
    label: options.label ?? value,
    efforts,
    defaultEffort: options.defaultEffort ?? "high",
    membershipRestricted: options.membershipRestricted ?? false,
  };
}
