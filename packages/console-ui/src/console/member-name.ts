export interface OperatorMemberIdentity {
  slug: string;
  displayName: string;
}

const BUILT_IN_MEMBER_NAMES: Readonly<Record<string, string>> = {
  ceo: "CEO",
  dev: "开发",
  "dev-manager": "技术负责人",
  "hermes-user": "用户代表",
  "product-manager": "产品",
  qa: "测试",
  secretary: "秘书",
  user: "你",
};

export function resolveOperatorMemberName(
  role: string | null,
  memberIdentities: readonly OperatorMemberIdentity[] = [],
  unknownLabel = "团队成员",
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
  return BUILT_IN_MEMBER_NAMES[role] ?? unknownLabel;
}
