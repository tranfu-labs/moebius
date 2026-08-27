import type { TimelineMessage } from "../conversation.js";

export interface LocalAgentPromptContext {
  readonly role: string;
  readonly agentMarkdown: string;
  readonly primaryAgent: string;
  readonly availableAgentNames: readonly string[];
}

export function createLocalAgentPromptContext(input: LocalAgentPromptContext): LocalAgentPromptContext {
  return Object.freeze({
    role: input.role,
    agentMarkdown: input.agentMarkdown,
    primaryAgent: input.primaryAgent,
    availableAgentNames: Object.freeze([...input.availableAgentNames]),
  });
}

export function buildLocalAgentPrompt(input: {
  role: LocalAgentPromptContext["role"];
  agentMarkdown: LocalAgentPromptContext["agentMarkdown"];
  timeline: readonly TimelineMessage[];
  primaryAgent: LocalAgentPromptContext["primaryAgent"];
  availableAgentNames: LocalAgentPromptContext["availableAgentNames"];
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

${AGENT_FORM_PROTOCOL}

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
  return buildPromptWithContract([
    buildLocalAgentDeltaBody(input),
  ]);
}

export function buildLocalResumeDeltaPrompt(input: {
  role: string;
  timeline: readonly TimelineMessage[];
  reason?: "graceful-shutdown" | "retry" | "edit-resend";
  correctionBody?: string;
}): string {
  const sections = input.reason === undefined
    ? []
    : [buildLocalResumeInstruction({
        reason: input.reason,
        correctionBody: input.correctionBody,
      })];
  sections.push(buildLocalAgentDeltaBody(input));
  return buildPromptWithContract(sections);
}

export function buildLocalResumePrompt(input: {
  reason: "graceful-shutdown" | "retry" | "edit-resend";
  correctionBody?: string;
}): string {
  return buildPromptWithContract([
    buildLocalResumeInstruction(input),
  ]);
}

function buildLocalAgentDeltaBody(input: {
  role: string;
  timeline: readonly TimelineMessage[];
}): string {
  return `以下是本地共享时间线中，你上次处理后新增、且不是你自己 <${input.role}> 发出的消息。请基于当前 provider session 的既有上下文继续回复。

新增公开消息：
${formatLocalTimeline(input.timeline)}`;
}

function buildLocalResumeInstruction(input: {
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

function buildPromptWithContract(sections: readonly string[]): string {
  return [...sections, AGENT_FORM_PROTOCOL, MANAGED_PROCESS_RUNTIME_CONTRACT].join("\n\n");
}

/**
 * Runtime-only protocol for the form card. The console strips a valid block from
 * the visible Agent message and turns the answers back into an ordinary message.
 * Keeping this next to the local prompt builder makes the capability available to
 * initial, delta, and resume invocations without changing provider contracts.
 */
export const AGENT_FORM_PROTOCOL = `Agent 表单协议（可选）:
- 当你需要用户在多个明确问题上作决定时，可以在本次回复末尾附加一份表单；不需要用户决定时继续只写普通 Markdown。
- 表单必须是独立的 fenced JSON，围栏标签必须是 moebius-form，不能写成代码块说明或工具调用：
\`\`\`moebius-form
{"id":"unique-form-id","memberName":"提问成员","memberSlug":"member-slug","questions":[{"id":"question-id","kind":"single","title":"问题","options":[{"id":"option-id","title":"选项","description":"帮助用户判断的补充说明"}]}]}
\`\`\`
- JSON 必须合法；questions 最多 4 题；每题 kind 只能是 single、multiple 或 text；single / multiple 每题最多写 2 个 options；text 不写 options。每道题和选项都要有稳定且不重复的 id、面向普通用户的 title。
- memberName 和 memberSlug 用来标记是谁在提问；表单围栏会被应用隐藏，围栏外的普通说明会照常显示。
- 用户提交表单后，应用会把按题目顺序组装的回答作为普通用户消息送回当前会话；不要要求用户使用特殊命令，也不要把表单回答当成工具调用结果。
- 如果表单写法不合规，应用会把整段内容按普通 Markdown 显示；因此不要依赖表单来传递不可丢失的事实。`;

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
