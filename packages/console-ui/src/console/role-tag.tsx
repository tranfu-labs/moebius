import { AgentPortrait } from "@/console/agent-portrait";
import { type ExecutionEngine } from "@/console/provider-mark";
import { identityToken } from "@/console/identity";
import { cn } from "@/lib/utils";

/**
 * i18n-exempt: developer-only identity marker documentation.
 * The marker is decorative; an adjacent readable name is always required.
 *
 * Agents get a portrait from the shared pool on their stable identity colour. The user
 * ("you") deliberately does NOT: they are the one human in the conversation, and keeping
 * them as an initial on the identity colour is what makes "me vs the agents" legible at a
 * glance in a dense timeline.
 */
export function RoleTag({
  label,
  toneKey,
  engine,
  className,
}: {
  label: string;
  toneKey?: string;
  /** Execution engine behind this agent, when the surrounding data carries it. */
  engine?: { cli: ExecutionEngine; providerId?: string };
  className?: string;
}): JSX.Element {
  const key = toneKey ?? label;
  if (toneKey === "user") {
    return (
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          className,
        )}
        style={{ backgroundColor: `var(${identityToken(key)})`, color: "var(--ident-fg)" }}
        aria-hidden="true"
      >
        {Array.from(label.trim())[0] ?? "?"}
      </span>
    );
  }
  return <AgentPortrait displayName={label} slug={key} engine={engine} className={className} />;
}

export { identityToken } from "@/console/identity";
