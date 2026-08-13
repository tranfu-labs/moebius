import { AlertCircle, CheckCircle2, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

export interface ProviderSettingsProfile {
  id: string;
  providerId: "deepseek";
  providerName: string;
  displayName: string;
  keySuffix: string;
  defaultModel: "deepseek-v4-flash" | "deepseek-v4-pro" | null;
  verifiedModels: Array<"deepseek-v4-flash" | "deepseek-v4-pro">;
  readiness: "ready" | "needs-attention" | "disabled";
  reason: string | null;
  revision: number;
  updatedAt: string;
  references: Array<{
    kind: "team-member" | "team-builder-draft" | "queued-task" | "resumable-session" | "single-run";
    ownerId: string;
    label: string;
    profileId: string;
    model: "deepseek-v4-flash" | "deepseek-v4-pro";
  }>;
  activity: {
    id: string;
    kind: string;
    status: string;
    completedTargets: string[];
    targetModels: string[];
    targetProfileId: string | null;
    targetOwnerIds: string[];
  } | null;
}

export interface ProviderSettingsController {
  state:
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; profiles: ProviderSettingsProfile[] };
  busyProfileId: string | null;
  error: string | null;
  canRetryCreateSave: boolean;
  refresh(): void;
  create(input: { displayName: string; apiKey: string; defaultModel: string }): Promise<boolean>;
  retryCreateSave(): Promise<boolean>;
  discardCreateSave(): void;
  rotateKey(profile: ProviderSettingsProfile, apiKey: string): Promise<boolean>;
  addModel(profile: ProviderSettingsProfile, model: string): Promise<boolean>;
  setDefaultModel(profile: ProviderSettingsProfile, model: string): Promise<boolean>;
  removeModel(profile: ProviderSettingsProfile, model: string): Promise<boolean>;
  replaceDefaultAndRemoveModel(profile: ProviderSettingsProfile, model: string, replacementDefaultModel: string): Promise<boolean>;
  rename(profile: ProviderSettingsProfile, displayName: string): Promise<boolean>;
  disable(profile: ProviderSettingsProfile): Promise<void>;
  enable(profile: ProviderSettingsProfile): Promise<void>;
  migrateReferences(profile: ProviderSettingsProfile, ownerIds: string[], targetProfileId: string, targetModel: string): Promise<boolean>;
  retryReferenceOperation(profile: ProviderSettingsProfile, operationId: string): Promise<boolean>;
  endReference(profile: ProviderSettingsProfile, ownerId: string): Promise<boolean>;
  delete(profile: ProviderSettingsProfile): Promise<void>;
  cancel(profileId: string): void;
}

export function ProviderSettingsPanel({ controller }: { controller: ProviderSettingsController }): JSX.Element {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState("DeepSeek");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek-v4-pro");

  if (controller.state.status === "loading") {
    return <PanelStatus icon={<LoaderCircle className="h-4 w-4 motion-safe:animate-spin" />} text={t("settings.providers.loading")} />;
  }
  if (controller.state.status === "error") {
    return (
      <div role="alert" className="rounded-sm border border-danger/30 bg-danger/5 p-4">
        <p className="text-sm text-danger">{controller.state.message}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={controller.refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />{t("settings.providers.retry")}
        </Button>
      </div>
    );
  }
  const profiles = controller.state.profiles;

  return (
    <section aria-labelledby="provider-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="provider-settings-title" className="text-sm font-normal">{t("settings.providers")}</h2>
          <p className="mt-1 text-sm text-sub">{t("settings.providers.description")}</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="mr-2 h-4 w-4" />{t("settings.providers.add")}
        </Button>
      </div>

      {adding ? (
        <form
          className="mt-4 grid gap-3 rounded-sm border border-line bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.create({ displayName, apiKey, defaultModel: model }).then((saved) => {
              if (saved) {
                setApiKey("");
                setAdding(false);
              }
            });
          }}
        >
          <div className="flex items-center gap-2 text-sm font-normal"><KeyRound className="h-4 w-4" />{t("settings.providers.addDeepSeek")}</div>
          <label className="grid gap-1 text-sm">
            <span>{t("settings.providers.profileName")}</span>
            <Input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t("settings.providers.apiKey")}</span>
            <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t("settings.providers.validationModel")}</span>
            <select className="h-9 rounded-sm border border-line bg-input px-3 text-sm" value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
              <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
            </select>
          </label>
          <p className="text-xs text-sub">{t("settings.providers.validationNotice")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => {
              if (controller.busyProfileId === "new") controller.cancel("new");
              controller.discardCreateSave();
              setApiKey("");
              setAdding(false);
            }}>{t("settings.providers.cancel")}</Button>
            {controller.canRetryCreateSave ? (
              <Button type="button" disabled={controller.busyProfileId !== null} onClick={() => {
                void controller.retryCreateSave().then((saved) => {
                  if (saved) {
                    setApiKey("");
                    setAdding(false);
                  }
                });
              }}>
                {controller.busyProfileId === "new" ? <LoaderCircle className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : null}
                {t("settings.providers.retrySave")}
              </Button>
            ) : <Button type="submit" disabled={controller.busyProfileId !== null || apiKey.trim().length < 8}>
              {controller.busyProfileId === "new" ? <LoaderCircle className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : null}
              {t("settings.providers.validateAndSave")}
            </Button>}
          </div>
        </form>
      ) : null}

      {controller.error !== null ? <p className="mt-3 text-sm text-danger" role="alert">{controller.error}</p> : null}

      <div className="mt-4 grid gap-3">
        {profiles.length === 0 && !adding ? (
          <div className="rounded-sm border border-dashed border-line p-6 text-center text-sm text-sub">{t("settings.providers.empty")}</div>
        ) : profiles.map((profile) => (
          <ProviderCard key={profile.id} profile={profile} allProfiles={profiles} controller={controller} />
        ))}
      </div>
    </section>
  );
}

function ProviderCard({ profile, allProfiles, controller }: { profile: ProviderSettingsProfile; allProfiles: ProviderSettingsProfile[]; controller: ProviderSettingsController }): JSX.Element {
  const { locale, t } = useI18n();
  const [replacing, setReplacing] = useState(false);
  const [replacementKey, setReplacementKey] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nextName, setNextName] = useState(profile.displayName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState(profile.id);
  const [targetModel, setTargetModel] = useState<string>(profile.verifiedModels[0] ?? "deepseek-v4-pro");
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<string[]>([]);
  const [endingOwnerId, setEndingOwnerId] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [confirmingEnable, setConfirmingEnable] = useState(false);
  const [defaultModelToRemove, setDefaultModelToRemove] = useState<string | null>(null);
  const [replacementDefaultModel, setReplacementDefaultModel] = useState<string>("");
  const availableModel = (["deepseek-v4-pro", "deepseek-v4-flash"] as const)
    .find((candidate) => !profile.verifiedModels.includes(candidate)) ?? null;
  const busy = controller.busyProfileId === profile.id;
  const targetProfiles = allProfiles.filter((candidate) => candidate.readiness === "ready");
  const selectedTargetProfile = targetProfiles.find((candidate) => candidate.id === targetProfileId) ?? null;
  const selectedReferences = profile.references.filter((reference) => selectedOwnerIds.includes(reference.ownerId));
  const migrationChangesAllSelected = selectedReferences.length > 0 && selectedReferences.every((reference) =>
    reference.profileId !== targetProfileId || reference.model !== targetModel
  );
  const hasMigrationDestination = targetProfiles.some((candidate) => candidate.verifiedModels.some((candidateModel) =>
    profile.references.some((reference) =>
      reference.profileId !== candidate.id || reference.model !== candidateModel
    )
  ));
  const status = profile.readiness === "ready"
    ? t("settings.providers.status.ready")
    : profile.readiness === "disabled"
      ? t("settings.providers.status.disabled")
      : t("settings.providers.status.needsAttention");
  const activity = profile.activity;
  const isReferenceActivity = activity !== null
    && (activity.kind === "migrate" || activity.kind === "end")
    && activity.targetOwnerIds.length > 0;
  const completedOwnerIds = new Set(activity?.completedTargets ?? []);
  const activityOwnerIds = new Set(activity?.targetOwnerIds ?? []);
  const referenceLabelsByOwnerId = new Map(allProfiles.flatMap((candidate) => candidate.references)
    .map((reference) => [reference.ownerId, reference.label] as const));
  const referenceLabel = (ownerId: string): string => referenceLabelsByOwnerId.get(ownerId) ?? ownerId;
  const completedReferenceLabels = (activity?.completedTargets ?? [])
    .filter((ownerId) => activityOwnerIds.has(ownerId))
    .map(referenceLabel);
  const pendingReferenceLabels = (activity?.targetOwnerIds ?? [])
    .filter((ownerId) => !completedOwnerIds.has(ownerId))
    .map(referenceLabel);
  const targetProfile = activity?.targetProfileId === null || activity?.targetProfileId === undefined
    ? null
    : allProfiles.find((candidate) => candidate.id === activity.targetProfileId) ?? null;
  return (
    <article className="rounded-sm border border-line bg-card p-4" aria-label={`${profile.displayName}，${status}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {renaming ? (
              <form className="flex flex-wrap gap-2" onSubmit={(event) => {
                event.preventDefault();
                void controller.rename(profile, nextName).then((saved) => {
                  if (saved) setRenaming(false);
                });
              }}>
                <Input className="h-8 max-w-64" value={nextName} maxLength={80} aria-label={t("settings.providers.renameLabel", { name: profile.displayName })} onChange={(event) => setNextName(event.target.value)} required />
                <Button size="sm" type="submit" disabled={busy || nextName.trim() === profile.displayName}>{t("settings.providers.saveName")}</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => { setNextName(profile.displayName); setRenaming(false); }}>{t("settings.providers.cancel")}</Button>
              </form>
            ) : <h3 className="font-normal">{profile.displayName}</h3>}
            <span className={cn("rounded-full px-2 py-0.5 text-xs", profile.readiness === "ready" ? "bg-pass/10 text-pass" : profile.readiness === "disabled" ? "bg-sunken text-sub" : "bg-accent/10 text-accent")}>{status}</span>
          </div>
          <p className="mt-1 text-sm text-sub">DeepSeek · Key •••• {profile.keySuffix}</p>
          <p className="mt-1 text-xs text-sub">{profile.defaultModel ?? t("settings.providers.defaultModelMissing")}</p>
          <p className="mt-1 text-xs text-sub">{t("settings.providers.lastUpdated", { date: new Date(profile.updatedAt).toLocaleString(locale) })}</p>
        </div>
        {busy ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin text-sub" aria-label={t("settings.providers.processing")} /> : profile.readiness === "ready" ? <CheckCircle2 className="h-4 w-4 text-pass" /> : <AlertCircle className="h-4 w-4 text-accent" />}
      </div>
      {profile.reason !== null ? <p className="mt-3 text-sm text-accent">{t(reasonKey(profile.reason))}</p> : null}
      {isReferenceActivity && activity !== null ? (
        <div className="mt-3 grid gap-2 rounded-sm border border-accent/30 bg-accent/5 p-3" data-testid="provider-migration-recovery" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-normal">
              {activity.status === "migrating"
                ? t("settings.providers.activity.migrationInProgress")
                : t("settings.providers.activity.migrationInterrupted")}
            </p>
            {activity.status === "migrating" ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin text-accent" aria-hidden="true" /> : null}
          </div>
          {targetProfile !== null && activity.targetModels[0] !== undefined ? (
            <p className="text-xs text-sub">
              {t("settings.providers.activity.target", {
                profile: targetProfile.displayName,
                model: modelLabel(activity.targetModels[0]),
              })}
            </p>
          ) : null}
          <div className="grid gap-2 text-xs">
            <div>
              <p className="font-normal text-sub">{t("settings.providers.activity.completed", { count: completedReferenceLabels.length })}</p>
              {completedReferenceLabels.length > 0 ? (
                <ul className="mt-1 grid gap-1 text-sub">
                  {completedReferenceLabels.map((label, index) => <li key={`completed:${index}:${label}`}>{label}</li>)}
                </ul>
              ) : null}
            </div>
            <div>
              <p className="font-normal text-sub">{t("settings.providers.activity.pending", { count: pendingReferenceLabels.length })}</p>
              {pendingReferenceLabels.length > 0 ? (
                <ul className="mt-1 grid gap-1 text-sub">
                  {pendingReferenceLabels.map((label) => <li key={`pending:${label}`}>{label}</li>)}
                </ul>
              ) : null}
            </div>
          </div>
          {activity.status !== "migrating" && pendingReferenceLabels.length > 0 ? (
            <Button
              size="sm"
              className="justify-self-start"
              disabled={busy}
              onClick={() => void controller.retryReferenceOperation(profile, activity.id)}
            >
              {busy ? <LoaderCircle className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : null}
              {t("settings.providers.activity.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 rounded-sm border border-line p-3" aria-label={t("settings.providers.modelsLabel", { name: profile.displayName })}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-normal text-sub">{t("settings.providers.verifiedModels")}</p>
          {availableModel !== null ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void controller.addModel(profile, availableModel)}
            >
              {t("settings.providers.validateAndAdd", { model: modelLabel(availableModel) })}
            </Button>
          ) : null}
        </div>
        {profile.verifiedModels.map((verifiedModel) => {
          const isDefault = profile.defaultModel === verifiedModel;
          return (
            <div key={verifiedModel} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{modelLabel(verifiedModel)}{isDefault ? <span className="ml-2 text-xs text-pass">{t("settings.providers.default")}</span> : null}</span>
              <span className="flex flex-wrap gap-1">
                {!isDefault ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.setDefaultModel(profile, verifiedModel)}>
                    {t("settings.providers.setDefault")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  disabled={busy || (isDefault && profile.verifiedModels.length < 2)}
                  title={isDefault ? t("settings.providers.chooseAnotherDefault") : t("settings.providers.removeModel")}
                  onClick={() => {
                    if (isDefault) {
                      setDefaultModelToRemove(verifiedModel);
                      setReplacementDefaultModel(profile.verifiedModels.find((candidate) => candidate !== verifiedModel) ?? "");
                    } else {
                      void controller.removeModel(profile, verifiedModel);
                    }
                  }}
                >
                  {t("settings.providers.remove")}
                </Button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 rounded-sm border border-line p-3">
        <p className="text-xs font-normal text-sub">{t("settings.providers.references", { count: profile.references.length })}</p>
        {profile.references.length === 0 ? (
          <p className="mt-2 text-sm text-sub">{t("settings.providers.noReferences")}</p>
        ) : (
          <ul className="mt-2 grid gap-2" aria-label={t("settings.providers.referencesLabel", { name: profile.displayName })}>
            {profile.references.map((reference) => (
              <li key={`${reference.kind}:${reference.ownerId}`} className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">
                  {reference.label}
                  <span className="mt-0.5 block text-xs text-sub">{t(referenceKindKey(reference.kind))} · {modelLabel(reference.model)}</span>
                </span>
                {reference.kind === "team-builder-draft" || reference.kind === "resumable-session" ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEndingOwnerId(reference.ownerId)}>
                    {t("settings.providers.endContinuation")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {profile.references.length > 0 ? (
          <Button className="mt-3" size="sm" variant="outline" disabled={busy || !hasMigrationDestination} onClick={() => {
            const initialTarget = targetProfiles.find((candidate) => candidate.id !== profile.id)
              ?? targetProfiles.find((candidate) => candidate.id === profile.id)
              ?? targetProfiles[0];
            const initialModel = initialTarget?.id === profile.id
              ? initialTarget.verifiedModels.find((candidateModel) => profile.references.every((reference) => reference.model !== candidateModel))
                ?? initialTarget.verifiedModels.find((candidateModel) => profile.references.some((reference) => reference.model !== candidateModel))
              : initialTarget?.verifiedModels[0];
            setTargetProfileId(initialTarget?.id ?? "");
            setTargetModel(initialModel ?? "");
            setSelectedOwnerIds(profile.references
              .filter((reference) => reference.kind !== "queued-task" && reference.kind !== "single-run")
              .map((reference) => reference.ownerId));
            setMigrating(true);
          }}>
            {t("settings.providers.migrateReferences")}
          </Button>
        ) : null}
      </div>
      {migrating ? (
        <form className="mt-3 grid gap-3 rounded-sm border border-line bg-sunken/40 p-3" onSubmit={(event) => {
          event.preventDefault();
          void controller.migrateReferences(profile, selectedOwnerIds, targetProfileId, targetModel).then((saved) => {
            if (saved) setMigrating(false);
          });
        }}>
          <p className="text-sm font-normal">{t("settings.providers.migrationTitle")}</p>
          <p className="text-xs text-sub">{t("settings.providers.migrationNotice")}</p>
          <div className="grid gap-2">
            {profile.references.map((reference) => {
              const migratable = reference.kind !== "queued-task" && reference.kind !== "single-run";
              return (
                <label key={`migrate:${reference.ownerId}`} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!migratable || busy}
                    checked={selectedOwnerIds.includes(reference.ownerId)}
                    onChange={(event) => setSelectedOwnerIds((current) => event.target.checked
                      ? [...new Set([...current, reference.ownerId])]
                      : current.filter((ownerId) => ownerId !== reference.ownerId))}
                  />
                  <span>{reference.label}{!migratable ? <span className="block text-xs text-sub">{t("settings.providers.finishBeforeMigration")}</span> : null}</span>
                </label>
              );
            })}
          </div>
          <label className="grid gap-1 text-sm">
            <span>{t("settings.providers.targetProfile")}</span>
            <select className="h-9 rounded-sm border border-line bg-input px-3 text-sm" value={targetProfileId} onChange={(event) => {
              const nextProfile = targetProfiles.find((candidate) => candidate.id === event.target.value);
              setTargetProfileId(event.target.value);
              setTargetModel(nextProfile?.verifiedModels[0] ?? "");
            }}>
              {targetProfiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.providerName} · {candidate.displayName}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t("settings.providers.targetModel")}</span>
            <select className="h-9 rounded-sm border border-line bg-input px-3 text-sm" value={targetModel} onChange={(event) => setTargetModel(event.target.value)}>
              {(selectedTargetProfile?.verifiedModels ?? []).map((candidate) => <option key={candidate} value={candidate}>{modelLabel(candidate)}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMigrating(false)}>{t("settings.providers.cancel")}</Button>
            <Button type="submit" disabled={busy || selectedTargetProfile === null || targetModel.length === 0 || !migrationChangesAllSelected}>
              {busy ? <LoaderCircle className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : null}
              {t("settings.providers.confirmMigration", { count: selectedOwnerIds.length })}
            </Button>
          </div>
        </form>
      ) : null}
      {replacing ? (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          void controller.rotateKey(profile, replacementKey).then((saved) => {
            if (saved) { setReplacementKey(""); setReplacing(false); }
          });
        }}>
          <p className="w-full text-xs text-sub">{t("settings.providers.rotationNotice", { count: profile.verifiedModels.length })}</p>
          <ul className="w-full text-xs text-sub">{profile.verifiedModels.map((candidate) => <li key={candidate}>{modelLabel(candidate)}</li>)}</ul>
          <Input className="min-w-52 flex-1" type="password" autoComplete="off" aria-label={t("settings.providers.replaceKeyLabel", { name: profile.displayName })} value={replacementKey} onChange={(event) => setReplacementKey(event.target.value)} />
          <Button type="submit" size="sm" disabled={busy || replacementKey.trim().length < 8}>{t("settings.providers.validateAllModels", { count: profile.verifiedModels.length })}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => {
            if (busy) controller.cancel(profile.id);
            setReplacementKey("");
            setReplacing(false);
          }}>{t("settings.providers.cancel")}</Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRenaming(true)}>{t("settings.providers.rename")}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setReplacing(true)}>{t("settings.providers.replaceKey")}</Button>
          {profile.readiness === "disabled" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingEnable(true)}>{t("settings.providers.enable")}</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingDisable(true)}>{t("settings.providers.disable")}</Button>
          )}
          <Button size="sm" variant="ghost" className="text-danger" disabled={busy || profile.references.length > 0} title={profile.references.length > 0 ? t("settings.providers.deleteBlocked") : t("settings.providers.delete")} onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="mr-2 h-4 w-4" />{t("settings.providers.delete")}
          </Button>
        </div>
      )}
      {confirmingDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) { setDeleteName(""); setConfirmingDelete(false); }
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`delete-provider-${profile.id}`} className="w-full max-w-md rounded-sm border border-line bg-card p-5 shadow-xl">
            <h4 id={`delete-provider-${profile.id}`} className="font-normal">{t("settings.providers.deleteTitle", { name: profile.displayName })}</h4>
            <p className="mt-2 text-sm text-sub">{t("settings.providers.deleteWarning", { provider: profile.providerName, name: profile.displayName })}</p>
            <label className="mt-4 grid gap-1 text-sm">
              <span>{t("settings.providers.typeName", { name: profile.displayName })}</span>
              <Input value={deleteName} autoComplete="off" onChange={(event) => setDeleteName(event.target.value)} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setDeleteName(""); setConfirmingDelete(false); }}>{t("settings.providers.cancel")}</Button>
              <Button variant="danger" disabled={busy || deleteName !== profile.displayName} onClick={() => void controller.delete(profile).then(() => { setDeleteName(""); setConfirmingDelete(false); })}>{t("settings.providers.confirmDelete")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {endingOwnerId !== null ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby={`end-provider-reference-${profile.id}`} className="w-full max-w-md rounded-sm border border-line bg-card p-5 shadow-xl">
            <h4 id={`end-provider-reference-${profile.id}`} className="font-normal">{t("settings.providers.endContinuationTitle")}</h4>
            <p className="mt-2 text-sm text-sub">{t("settings.providers.endContinuationWarning")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEndingOwnerId(null)}>{t("settings.providers.cancel")}</Button>
              <Button variant="danger" disabled={busy} onClick={() => void controller.endReference(profile, endingOwnerId).then((saved) => {
                if (saved) setEndingOwnerId(null);
              })}>{t("settings.providers.confirmEndContinuation")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmingDisable ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby={`disable-provider-${profile.id}`} className="w-full max-w-md rounded-sm border border-line bg-card p-5 shadow-xl">
            <h4 id={`disable-provider-${profile.id}`} className="font-normal">{t("settings.providers.disableTitle", { name: profile.displayName })}</h4>
            <p className="mt-2 text-sm text-sub">{t("settings.providers.disableWarning", { count: profile.references.length })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmingDisable(false)}>{t("settings.providers.cancel")}</Button>
              <Button variant="danger" disabled={busy} onClick={() => void controller.disable(profile).then(() => setConfirmingDisable(false))}>{t("settings.providers.confirmDisable")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmingEnable ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby={`enable-provider-${profile.id}`} className="w-full max-w-md rounded-sm border border-line bg-card p-5 shadow-xl">
            <h4 id={`enable-provider-${profile.id}`} className="font-normal">{t("settings.providers.enableTitle", { name: profile.displayName })}</h4>
            <p className="mt-2 text-sm text-sub">{t("settings.providers.enableWarning", { count: profile.verifiedModels.length })}</p>
            <ul className="mt-3 grid gap-1 text-sm">{profile.verifiedModels.map((candidate) => <li key={candidate}>{modelLabel(candidate)}</li>)}</ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmingEnable(false)}>{t("settings.providers.cancel")}</Button>
              <Button disabled={busy} onClick={() => void controller.enable(profile).then(() => setConfirmingEnable(false))}>{t("settings.providers.confirmEnable")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {defaultModelToRemove !== null ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby={`replace-default-model-${profile.id}`} className="w-full max-w-md rounded-sm border border-line bg-card p-5 shadow-xl">
            <h4 id={`replace-default-model-${profile.id}`} className="font-normal">{t("settings.providers.replaceDefaultBeforeRemove")}</h4>
            <p className="mt-2 text-sm text-sub">{t("settings.providers.replaceDefaultBeforeRemoveWarning", { model: modelLabel(defaultModelToRemove) })}</p>
            <label className="mt-4 grid gap-1 text-sm">
              <span>{t("settings.providers.newDefaultModel")}</span>
              <select className="h-9 rounded-sm border border-line bg-input px-3 text-sm" value={replacementDefaultModel} onChange={(event) => setReplacementDefaultModel(event.target.value)}>
                {profile.verifiedModels.filter((candidate) => candidate !== defaultModelToRemove).map((candidate) => <option key={candidate} value={candidate}>{modelLabel(candidate)}</option>)}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDefaultModelToRemove(null)}>{t("settings.providers.cancel")}</Button>
              <Button variant="danger" disabled={busy || replacementDefaultModel.length === 0} onClick={() => void controller.replaceDefaultAndRemoveModel(profile, defaultModelToRemove, replacementDefaultModel).then((saved) => {
                if (saved) setDefaultModelToRemove(null);
              })}>{t("settings.providers.saveDefaultAndRemove")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function PanelStatus({ icon, text }: { icon: JSX.Element; text: string }): JSX.Element {
  return <p className="flex items-center gap-2 text-sm text-sub" role="status">{icon}{text}</p>;
}

function reasonKey(reason: string): TranslationKey {
  return ({
    "credential-invalid": "settings.providers.reason.credentialInvalid",
    "model-incompatible": "settings.providers.reason.modelIncompatible",
    "provider-removed": "settings.providers.reason.providerRemoved",
    "rate-limited": "settings.providers.reason.rateLimited",
    quota: "settings.providers.reason.quota",
    network: "settings.providers.reason.network",
    "provider-unavailable": "settings.providers.reason.providerUnavailable",
    "local-save-failed": "settings.providers.reason.localSaveFailed",
  } as const)[reason as "credential-invalid" | "model-incompatible" | "provider-removed" | "rate-limited" | "quota" | "network" | "provider-unavailable" | "local-save-failed"] ?? "settings.providers.reason.default";
}

function referenceKindKey(kind: ProviderSettingsProfile["references"][number]["kind"]): TranslationKey {
  return ({
    "team-member": "settings.providers.reference.teamMember",
    "team-builder-draft": "settings.providers.reference.teamBuilderDraft",
    "queued-task": "settings.providers.reference.queuedTask",
    "resumable-session": "settings.providers.reference.resumableSession",
    "single-run": "settings.providers.reference.singleRun",
  } as const)[kind];
}

function modelLabel(model: string): string {
  return model === "deepseek-v4-pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash";
}
