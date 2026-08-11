import { useI18n } from "@/i18n";
import {
  findExecutionModel,
  findPiExecutionModel,
  isRegisteredExecutionEffort,
  listExecutionModels,
  PI_EXECUTION_MODELS,
  resolveProfileForCli,
  resolveProfileForModel,
} from "@/console/execution-profile-registry";
import type {
  AgentExecutionProfile,
  AgentExecutionProviderProfile,
} from "@/console/agent-team-detail";

export interface ExecutionProfileFieldsProps {
  profile: AgentExecutionProfile;
  disabled?: boolean;
  providerProfiles?: readonly AgentExecutionProviderProfile[];
  onOpenProviderSettings?(): void;
  onChange(profile: AgentExecutionProfile): void;
}

/**
 * Shared CLI / Provider / model / effort selector used by both the team-member
 * runtime profile editor and the settings default-Agent panel. Static
 * validation and legacy-value retention rules MUST stay identical in both
 * places (see the default-Agent section of `docs/product/pages/settings.md`).
 */
export function ExecutionProfileFields({
  profile,
  disabled = false,
  providerProfiles = [],
  onOpenProviderSettings,
  onChange,
}: ExecutionProfileFieldsProps): JSX.Element {
  const { t } = useI18n();
  const validity = deriveExecutionProfileFieldsValidity(profile, providerProfiles);
  const selectableProviderProfiles = providerProfiles.filter((candidate) => candidate.readiness === "ready");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 text-xs text-hint">
          {t("console.agentTeamDetail.executionEngineLabel")}
          <select
            aria-label={t("console.agentTeamDetail.executionEngineLabel")}
            className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
            value={profile.cli}
            disabled={disabled}
            onChange={(event) => onChange(
              resolveProfileForEngine(event.currentTarget.value as AgentExecutionProfile["cli"], selectableProviderProfiles),
            )}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
            <option value="kimi">Kimi</option>
            <option value="pi">Pi API</option>
          </select>
        </label>
        {profile.cli === "pi" ? (
          <label className="grid gap-1.5 text-xs text-hint">
            Provider
            <select
              aria-label="Provider"
              className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
              value={profile.providerProfileId}
              disabled={disabled}
              aria-invalid={validity.providerError !== null}
              onChange={(event) => onChange(
                resolvePiProviderProfile(event.currentTarget.value, selectableProviderProfiles),
              )}
            >
              <option value="">{t("console.agentTeamDetail.selectProviderProfilePlaceholder")}</option>
              {validity.selectedProviderProfile !== null && validity.selectedProviderProfile.readiness !== "ready" ? (
                <option value={validity.selectedProviderProfile.id}>
                  {t("console.agentTeamDetail.providerUnavailableOption", {
                    providerName: validity.selectedProviderProfile.providerName,
                    displayName: validity.selectedProviderProfile.displayName,
                  })}
                </option>
              ) : null}
              {selectableProviderProfiles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.providerName} · {candidate.displayName}</option>
              ))}
            </select>
            {validity.providerError !== null ? <span className="text-danger">{t(validity.providerError)}</span> : null}
            {selectableProviderProfiles.length === 0 && onOpenProviderSettings !== undefined ? (
              <button type="button" className="w-fit text-xs text-accent hover:underline" onClick={onOpenProviderSettings}>
                {t("console.agentTeamDetail.goToProviderSettings")}
              </button>
            ) : null}
          </label>
        ) : null}
        <label className="grid gap-1.5 text-xs text-hint">
          Model
          <select
            aria-label="Model"
            className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
            value={profile.model}
            disabled={disabled}
            aria-invalid={validity.modelError !== null}
            onChange={(event) => onChange(resolveSelectedModel(profile, event.currentTarget.value))}
          >
            {profile.cli === "pi" && profile.model === "" ? (
              <option value="">{t("console.agentTeamDetail.selectVerifiedModelPlaceholder")}</option>
            ) : null}
            {validity.modelUnsupported && profile.model !== "" ? (
              <option value={profile.model}>
                {t("console.agentTeamDetail.legacyModelOption", { model: profile.model })}
              </option>
            ) : null}
            {(profile.cli === "pi"
              ? PI_EXECUTION_MODELS.filter((model) => validity.selectedProviderProfile?.verifiedModels.includes(model.value as "deepseek-v4-flash" | "deepseek-v4-pro") === true)
              : listExecutionModels(profile.cli)).map((model) => (
              <option key={model.value} value={model.value}>
                {model.membershipRestricted
                  ? t("console.agentTeamDetail.membershipModelOption", { model: model.label })
                  : model.label}
              </option>
            ))}
          </select>
          {validity.modelError !== null ? <span className="text-danger">{t(validity.modelError)}</span> : null}
        </label>
        <label className="grid gap-1.5 text-xs text-hint">
          {t("console.agentTeamDetail.effort")}
          <select
            aria-label={t("console.agentTeamDetail.effort")}
            className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
            value={profile.effort}
            disabled={disabled}
            aria-invalid={validity.effortError !== null}
            onChange={(event) => onChange({ ...profile, effort: event.currentTarget.value })}
          >
            {validity.effortUnsupported ? (
              <option value={profile.effort}>
                {t("console.agentTeamDetail.legacyEffortOption", { effort: profile.effort })}
              </option>
            ) : null}
            {validity.modelDefinition?.efforts.map((effort) => (
              <option key={effort} value={effort}>{effort}</option>
            ))}
          </select>
          {validity.effortError !== null ? <span className="text-danger">{t(validity.effortError)}</span> : null}
        </label>
      </div>
      {validity.modelUnsupported || validity.effortUnsupported ? (
        <p className="mt-3 text-sm text-sub" role="status">
          {t("console.agentTeamDetail.legacyProfileNotice")}
        </p>
      ) : null}
    </>
  );
}

interface ExecutionProfileFieldsValidity {
  modelError: "console.agentTeamDetail.enterModel" | null;
  effortError: "console.agentTeamDetail.enterEffort" | null;
  providerError: "console.agentTeamDetail.selectReadyProviderProfile" | null;
  selectedProviderProfile: AgentExecutionProviderProfile | null;
  modelDefinition: ReturnType<typeof findExecutionModel> | ReturnType<typeof findPiExecutionModel>;
  modelUnsupported: boolean;
  effortUnsupported: boolean;
}

function deriveExecutionProfileFieldsValidity(
  profile: AgentExecutionProfile,
  providerProfiles: readonly AgentExecutionProviderProfile[],
): ExecutionProfileFieldsValidity {
  const selectedProviderProfile = profile.cli === "pi"
    ? providerProfiles.find((candidate) => candidate.id === profile.providerProfileId) ?? null
    : null;
  const modelDefinition = profile.cli === "pi"
    ? findPiExecutionModel(profile.model)
    : findExecutionModel(profile.cli, profile.model);
  return {
    modelError: profile.model.trim().length === 0 ? "console.agentTeamDetail.enterModel" : null,
    effortError: profile.effort.trim().length === 0 ? "console.agentTeamDetail.enterEffort" : null,
    providerError: profile.cli === "pi" && (selectedProviderProfile === null || selectedProviderProfile.readiness !== "ready")
      ? "console.agentTeamDetail.selectReadyProviderProfile"
      : null,
    selectedProviderProfile,
    modelDefinition,
    modelUnsupported: modelDefinition === null,
    effortUnsupported: profile.cli === "pi"
      ? findPiExecutionModel(profile.model)?.efforts.includes(profile.effort) !== true
      : !isRegisteredExecutionEffort(profile.cli, profile.model, profile.effort),
  };
}

/** Save-button gating: mirrors the field-level validity above without re-deriving it twice. */
export function isExecutionProfileValid(
  profile: AgentExecutionProfile,
  providerProfiles: readonly AgentExecutionProviderProfile[],
): boolean {
  const validity = deriveExecutionProfileFieldsValidity(profile, providerProfiles);
  return validity.modelError === null
    && validity.effortError === null
    && validity.providerError === null
    && (profile.cli !== "pi" || validity.selectedProviderProfile?.verifiedModels.includes(
      profile.model as "deepseek-v4-flash" | "deepseek-v4-pro",
    ) === true);
}

export function resolveProfileForEngine(
  engine: AgentExecutionProfile["cli"],
  providers: readonly AgentExecutionProviderProfile[],
): AgentExecutionProfile {
  if (engine !== "pi") return resolveProfileForCli(engine);
  return providers.length === 1
    ? resolvePiProviderProfile(providers[0]!.id, providers)
    : { cli: "pi", providerId: "deepseek", providerProfileId: "", model: "", effort: "high" };
}

export function resolvePiProviderProfile(
  profileId: string,
  providers: readonly AgentExecutionProviderProfile[],
): AgentExecutionProfile {
  const profile = providers.find((candidate) => candidate.id === profileId);
  const model = profile?.defaultModel !== null
    && profile?.verifiedModels.includes(profile.defaultModel) === true
    ? profile.defaultModel
    : "";
  return {
    cli: "pi",
    providerId: "deepseek",
    providerProfileId: profile?.id ?? "",
    model,
    effort: findPiExecutionModel(model)?.defaultEffort ?? "high",
  };
}

export function resolveSelectedModel(
  profile: AgentExecutionProfile,
  model: string,
): AgentExecutionProfile {
  if (profile.cli !== "pi") return resolveProfileForModel(profile, model);
  const definition = findPiExecutionModel(model);
  return {
    ...profile,
    model,
    effort: profile.model !== "" && definition?.efforts.includes(profile.effort) === true
      ? profile.effort
      : definition?.defaultEffort ?? profile.effort,
  };
}
