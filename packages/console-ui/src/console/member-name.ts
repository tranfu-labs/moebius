import type { Translate, TranslationKey } from "@/i18n";

export interface OperatorMemberIdentity {
  slug: string;
  displayName: string;
  /**
   * Execution engine behind this member. Optional because the timeline can render before the
   * team's execution profiles are known; the portrait simply omits the badge until they are.
   */
  engine?: { cli: "codex" | "claude" | "kimi" | "pi"; providerId?: string };
}

/** Engine for a role, or undefined when the roster does not carry one. */
export function resolveOperatorMemberEngine(
  role: string | null,
  identities: readonly OperatorMemberIdentity[],
): OperatorMemberIdentity["engine"] {
  if (role === null) {
    return undefined;
  }
  return identities.find((identity) => identity.slug === role)?.engine;
}

const builtInMemberKeys: Readonly<Record<string, TranslationKey>> = {
  ceo: "console.role.ceo",
  dev: "console.role.dev",
  "dev-manager": "console.role.devManager",
  "hermes-user": "console.role.user",
  "product-manager": "console.role.product",
  qa: "console.role.qa",
  secretary: "console.role.secretary",
  user: "console.common.you",
};

export function resolveOperatorMemberName(
  role: string | null,
  memberIdentities: readonly OperatorMemberIdentity[],
  t: Translate,
  unknownLabel = t("console.common.collaborator"),
): string {
  if (role === null || role.trim() === "") {
    return unknownLabel;
  }
  const identity = memberIdentities.find((member) => member.slug === role);
  if (identity !== undefined) {
    return identity.displayName.trim() || `@${identity.slug}`;
  }
  if (memberIdentities.length > 0) {
    return unknownLabel;
  }
  const key = builtInMemberKeys[role];
  return key === undefined ? unknownLabel : t(key);
}
