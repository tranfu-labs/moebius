import { cn } from "@/lib/utils";
import { identityToken } from "@/console/role-tag";

export type AgentInitialAvatarSize = "compact" | "heading";

export interface AgentInitialAvatarProps {
  displayName: string;
  slug: string;
  size?: AgentInitialAvatarSize;
  className?: string;
}

export function agentInitialGlyph(displayName: string, slug: string): string {
  const source = displayName.trim() || slug.trim();
  const glyph = Array.from(source)[0] ?? "A";
  return /^[a-z]$/iu.test(glyph) ? glyph.toLocaleUpperCase("en-US") : glyph;
}

export function AgentInitialAvatar({
  displayName,
  slug,
  size = "compact",
  className,
}: AgentInitialAvatarProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-agent-initial-avatar={slug}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        size === "heading" ? "h-8 w-8 text-xs" : "h-5 w-5 text-[10px]",
        className,
      )}
      style={{
        backgroundColor: `var(${identityToken(slug)})`,
        color: "var(--ident-fg)",
      }}
    >
      {agentInitialGlyph(displayName, slug)}
    </span>
  );
}
