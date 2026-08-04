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
${formatLocalTimeline(input.timeline)}

${MANAGED_PROCESS_RUNTIME_CONTRACT}`;
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
${formatLocalTimeline(input.timeline)}

${MANAGED_PROCESS_RUNTIME_CONTRACT}`;
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
      "",
      MANAGED_PROCESS_RUNTIME_CONTRACT,
    ].join("\n");
  }
  return [
    "继续刚才未完成的同一次执行。",
    "先检查当前工作空间状态，从中断处继续，避免重复已经完成的文件或外部副作用。",
    "",
    MANAGED_PROCESS_RUNTIME_CONTRACT,
  ].join("\n");
}

export const MANAGED_PROCESS_RUNTIME_CONTRACT = `Moebius 托管进程契约（v1）：
- 凡需在当前工具调用或 Agent 回合结束后继续运行、并需要用户持续监督的服务、watcher 或 task，必须使用 managed_process 工具；不得用 shell 后台符号、nohup、setsid、double-fork 或类似方式逃逸。
- service/watcher 是无自然终点的运行项；task 只用于有自然终点、但明确需要跨 invocation 存活或持续监督的工作。普通一次性 Python、测试和构建即使耗时，也继续使用 Provider 的前台命令工具。
- managed_process_start 只接受命令名、args 数组、工作区相对 cwd 和可选 loopback readiness/endpoint；不得提交 shell 字符串、任意环境变量、PID 或 PGID。
- 工具不可发现、初始化或调用失败时必须如实失败，不得回退到原生后台 shell，也不得把正文里的 JSON 当成工具调用。`;

export function formatLocalTimeline(messages: readonly TimelineMessage[]): string {
  return messages
    .map((message) => `#${message.index} <${message.speaker}>:\n${message.body.trimEnd()}`)
    .join("\n\n");
}
