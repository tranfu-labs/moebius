export function planChildSessionCreation(input: {
  parentSessionId: string;
  childSessionId: string;
  projectId: string;
  title: string;
  relation?: string;
  hiddenKey: string;
  initialBody: string;
  initialRole?: string | null;
  now: string;
}) {
  return {
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId,
    projectId: input.projectId,
    title: input.title,
    relation: input.relation ?? "task",
    hiddenKey: input.hiddenKey,
    initialBody: input.initialBody,
    initialRole: input.initialRole ?? null,
    now: input.now,
  };
}
