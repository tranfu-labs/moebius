export type ExecutionProfileCli = "codex" | "claude" | "kimi";

export interface RegistryCliExecutionProfile {
  cli: ExecutionProfileCli;
  model: string;
  effort: string;
}

export type RegistryExecutionProfile = RegistryCliExecutionProfile | {
  cli: "pi";
  providerId: "deepseek";
  providerProfileId: string;
  model: string;
  effort: string;
};

export interface RegistryProviderProfile {
  id: string;
  providerId: "deepseek";
  displayName: string;
  defaultModel: "deepseek-v4-flash" | "deepseek-v4-pro" | null;
  verifiedModels: Array<"deepseek-v4-flash" | "deepseek-v4-pro">;
  readiness: "ready" | "needs-attention" | "disabled";
}

export interface ExecutionModelRegistryEntry {
  value: string;
  label: string;
  efforts: readonly string[];
  defaultEffort: string;
  membershipRestricted: boolean;
}

export type ExecutionModelRegistry = Readonly<Record<
  ExecutionProfileCli,
  readonly ExecutionModelRegistryEntry[]
>>;

export type ExecutionRegistryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; registry: ExecutionModelRegistry };

export const EXECUTION_MODEL_REGISTRY: ExecutionModelRegistry = {
  codex: [
    codexModel("gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]),
    codexModel("gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]),
    codexModel("gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]),
    codexModel("gpt-5.5", ["low", "medium", "high", "xhigh"]),
    codexModel("gpt-5.4", ["low", "medium", "high", "xhigh"]),
    codexModel("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
  ],
  claude: [
    claudeModel("fable", ["low", "medium", "high", "xhigh", "max"]),
    claudeModel("sonnet", ["low", "medium", "high", "max"]),
    claudeModel("opus", ["low", "medium", "high", "max"]),
  ],
  kimi: [
    kimiModel("kimi-code/kimi-for-coding", "kimi-for-coding", ["on"], "on", false),
    kimiModel("kimi-code/k3", "k3", ["low", "high", "max"], "high", true),
    kimiModel("kimi-code/k3-256k", "k3-256k", ["low", "high", "max"], "high", true),
    kimiModel(
      "kimi-code/kimi-for-coding-highspeed",
      "kimi-for-coding-highspeed",
      ["on"],
      "on",
      true,
    ),
  ],
};

export const DEFAULT_EXECUTION_PROFILES = {
  codex: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
  claude: { cli: "claude", model: "sonnet", effort: "high" },
  kimi: { cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" },
} as const satisfies Record<ExecutionProfileCli, RegistryCliExecutionProfile>;

export function listExecutionModels(
  cli: ExecutionProfileCli,
  registry: ExecutionModelRegistry = EXECUTION_MODEL_REGISTRY,
): readonly ExecutionModelRegistryEntry[] {
  return registry[cli];
}

export function findExecutionModel(
  cli: ExecutionProfileCli,
  model: string,
  registry: ExecutionModelRegistry = EXECUTION_MODEL_REGISTRY,
): ExecutionModelRegistryEntry | null {
  return listExecutionModels(cli, registry).find((candidate) => candidate.value === model) ?? null;
}

export function resolveProfileForCli(
  cli: ExecutionProfileCli,
  registry: ExecutionModelRegistry = EXECUTION_MODEL_REGISTRY,
): RegistryCliExecutionProfile {
  const preferred = DEFAULT_EXECUTION_PROFILES[cli];
  const model = findExecutionModel(cli, preferred.model, registry) ?? registry[cli][0];
  return model === undefined
    ? { ...preferred }
    : { cli, model: model.value, effort: model.defaultEffort };
}

export function resolveProfileForModel(
  profile: RegistryCliExecutionProfile,
  model: string,
  registry: ExecutionModelRegistry = EXECUTION_MODEL_REGISTRY,
): RegistryCliExecutionProfile {
  const definition = findExecutionModel(profile.cli, model, registry);
  if (definition === null) {
    return { ...profile };
  }
  return {
    ...profile,
    model,
    effort: definition.efforts.includes(profile.effort)
      ? profile.effort
      : definition.defaultEffort,
  };
}

export function isRegisteredExecutionEffort(
  cli: ExecutionProfileCli,
  model: string,
  effort: string,
  registry: ExecutionModelRegistry = EXECUTION_MODEL_REGISTRY,
): boolean {
  return findExecutionModel(cli, model, registry)?.efforts.includes(effort) ?? false;
}

function codexModel(
  value: string,
  efforts: readonly string[],
): ExecutionModelRegistryEntry {
  return {
    value,
    label: value,
    efforts,
    defaultEffort: "high",
    membershipRestricted: false,
  };
}

function kimiModel(
  value: string,
  label: string,
  efforts: readonly string[],
  defaultEffort: string,
  membershipRestricted: boolean,
): ExecutionModelRegistryEntry {
  return { value, label, efforts, defaultEffort, membershipRestricted };
}

function claudeModel(
  value: string,
  efforts: readonly string[],
): ExecutionModelRegistryEntry {
  return {
    value,
    label: value,
    efforts,
    defaultEffort: "high",
    membershipRestricted: false,
  };
}

export const PI_EXECUTION_MODELS: readonly ExecutionModelRegistryEntry[] = [
  piModel("deepseek-v4-flash", "DeepSeek V4 Flash", "high"),
  piModel("deepseek-v4-pro", "DeepSeek V4 Pro", "high"),
];

export function findPiExecutionModel(model: string): ExecutionModelRegistryEntry | null {
  return PI_EXECUTION_MODELS.find((candidate) => candidate.value === model) ?? null;
}

function piModel(
  value: string,
  label: string,
  defaultEffort: string,
): ExecutionModelRegistryEntry {
  return {
    value,
    label,
    efforts: ["high", "max"],
    defaultEffort,
    membershipRestricted: false,
  };
}
