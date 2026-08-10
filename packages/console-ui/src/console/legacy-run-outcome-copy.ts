/**
 * Sanitizer for terminal-record bodies written before the run status moved into
 * the UI.
 *
 * These sentences are historical *stored data*, not interface copy: older
 * runtime versions persisted a full "state sentence + guidance" string into
 * `session_messages.body`, which the status bubble now states itself. Rendering
 * both repeats the state and re-adds the guidance the action icons already
 * carry, so the known sentences are stripped and only a genuine engine
 * diagnostic survives.
 *
 * Delete this module once the runtime no longer writes guidance bodies and no
 * live database still holds rows that do.
 */
const LEGACY_BOILERPLATE: readonly (readonly [string, string])[] = [
  ["这一步的工具调用运行过久，已经停下。", "工具调用运行过久"],
  ["这一步反复没跑起来，已经不再重试。", ""],
  ["这一步卡住了。", ""],
  ["这一步没跑起来。", ""],
  ["你让这一步停下了。", ""],
  ["这一步被系统停止了。", ""],
  ["你可以直接告诉主理人下一步怎么处理。", ""],
  ["你可以重试，或直接说话、换一个成员接手。", ""],
  ["你可以重试，或换一个执行配置。", ""],
  ["你可以说点什么，或换一个成员接手。", ""],
  ["已经产生的文件改动会保留。", ""],
];

export function stripLegacyOutcomeBoilerplate(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  if (text === "") return "";
  return LEGACY_BOILERPLATE
    .reduce((current, [sentence, replacement]) => current.split(sentence).join(replacement), text)
    .trim();
}
