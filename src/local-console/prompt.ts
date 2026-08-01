import type { TimelineMessage } from "../conversation.js";

export function buildLocalAgentPrompt(input: {
  role: string;
  agentMarkdown: string;
  timeline: readonly TimelineMessage[];
  primaryAgent: string;
  availableAgentNames: readonly string[];
}): string {
  const roster = input.availableAgentNames.map((name) => `@${name}`).join("、");
  return `${input.agentMarkdown.trimEnd()}

本地团队上下文：
- 当前环境是本地对话 session。
- 当前团队主 Agent：@${input.primaryAgent}
- 当前可用成员：${roster}
- 合法的 @成员 表示把下一步控制权交给该成员。
- 如果你不是主 Agent且没有明确的下一位专业成员，请把控制权交回 @${input.primaryAgent}。
- 如果你是主 Agent，请结合完整时间线自由决定继续派工、询问用户或给出不含成员 mention 的可见收尾。
- 不要根据“验收”“通过”“不通过”等自然语言猜测或声明程序状态；这些词只表达专业判断。

当前本地对话时间线：
${formatLocalTimeline(input.timeline)}`;
}

export function selectLocalTimelineDelta(
  timeline: readonly TimelineMessage[],
  role: string,
  lastSeenIndex: number,
): TimelineMessage[] {
  return timeline.filter((message) =>
    message.index > lastSeenIndex && message.speaker !== role);
}

export function buildLocalAgentDeltaPrompt(input: {
  role: string;
  timeline: readonly TimelineMessage[];
}): string {
  return `以下是本地共享时间线中，你上次处理后新增、且不是你自己 <${input.role}> 发出的消息。请基于当前 provider session 的既有上下文继续回复。

新增公开消息：
${formatLocalTimeline(input.timeline)}`;
}

export function buildLocalResumePrompt(input: {
  reason: "graceful-shutdown" | "retry" | "edit-resend";
  correctionBody?: string;
}): string {
  if (input.reason === "edit-resend") {
    return [
      "继续刚才未完成的同一次执行。",
      "用户已修正原指令；下面的新指令覆盖与原指令冲突的部分。先检查当前工作空间状态，避免重复已经完成的副作用。",
      "",
      input.correctionBody?.trim() ?? "",
    ].join("\n");
  }
  return [
    "继续刚才未完成的同一次执行。",
    "先检查当前工作空间状态，从中断处继续，避免重复已经完成的文件或外部副作用。",
  ].join("\n");
}

export function formatLocalTimeline(messages: readonly TimelineMessage[]): string {
  return messages
    .map((message) => `#${message.index} <${message.speaker}>:\n${message.body.trimEnd()}`)
    .join("\n\n");
}
