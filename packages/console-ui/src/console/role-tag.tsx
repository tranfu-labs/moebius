import { cn } from "@/lib/utils";

/**
 * i18n-exempt: developer-only identity marker documentation.
 * Uses a stable identity-token color and the first glyph of the role name.
 * The marker is decorative; an adjacent readable name is always required.
 */
export function RoleTag({
  label,
  toneKey,
  className,
}: {
  label: string;
  toneKey?: string;
  className?: string;
}): JSX.Element {
  const initial = Array.from(label.trim())[0] ?? "?";
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        className,
      )}
      style={{
        backgroundColor: `var(${identityToken(toneKey ?? label)})`,
        color: "var(--ident-fg)",
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

const IDENTITY_TOKENS = ["--ident-1", "--ident-2", "--ident-3", "--ident-4", "--ident-5", "--ident-6"] as const;

export function identityToken(key: string): (typeof IDENTITY_TOKENS)[number] {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  }
  return IDENTITY_TOKENS[Math.abs(hash) % IDENTITY_TOKENS.length];
}
