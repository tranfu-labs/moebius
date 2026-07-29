const CONTROL_MARKER_PATTERN =
  /<!--[ \t\r\n]*moebius:session-analysis-control=([\s\S]*?)[ \t\r\n]*-->$/u;

export type SessionAnalysisControl =
  | { action: "proposal"; version: string }
  | { action: "confirm"; version: string };

export interface ParsedSessionAnalysisResponse {
  visibleText: string;
  control: SessionAnalysisControl | null;
}

export function buildSessionAnalysisReadOnlyContract(currentProposalVersion: string | null): string {
  return `

会话分析写入规则（受运行时强制执行）：
- 当前回合处于只读环境。可以读取、搜索和运行无副作用诊断，但不得修改任何本地文件或持久状态。
- 先分析并给出可确认的优化方案。提出新方案或改变方案时，在最终回复末尾追加：
  <!-- moebius:session-analysis-control={"action":"proposal","version":"<本方案唯一版本>"} -->
- 当前可确认方案版本：${currentProposalVersion ?? "无"}。
- 只有当用户自然语言明确确认当前完整方案时，才在最终回复末尾追加：
  <!-- moebius:session-analysis-control={"action":"confirm","version":"${currentProposalVersion ?? "<当前版本>"}"} -->
- 模糊赞同、局部确认、带修改意见的确认、版本不明或方案已变化时不得返回 confirm；继续只读讨论，并在方案变化时登记新版本。
- 控制注释是运行时协议，不要在可见正文中解释、引用或放进 Markdown 代码块。`.trimEnd();
}

export function buildConfirmedPlanExecutionPrompt(version: string): string {
  return `用户已经确认方案版本 ${version}。现在执行这一版方案，并在完成后报告改动、验证与剩余风险。该写入许可只覆盖本次紧接着的执行尝试；不要扩大方案范围。`;
}

export function parseSessionAnalysisResponse(source: string): ParsedSessionAnalysisResponse {
  const trimmed = source.trimEnd();
  const marker = CONTROL_MARKER_PATTERN.exec(trimmed);
  if (marker === null || marker.index === undefined) {
    return { visibleText: source, control: null };
  }
  const raw = marker[1] ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { visibleText: source, control: null };
  }
  const control = readControl(parsed);
  if (control === null) {
    return { visibleText: source, control: null };
  }
  return {
    visibleText: trimmed.slice(0, marker.index).trimEnd(),
    control,
  };
}

function readControl(value: unknown): SessionAnalysisControl | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const version = typeof candidate.version === "string" ? candidate.version.trim() : "";
  if (
    (candidate.action !== "proposal" && candidate.action !== "confirm")
    || version === ""
    || version.length > 128
    || !/^[A-Za-z0-9._:-]+$/u.test(version)
  ) {
    return null;
  }
  return { action: candidate.action, version };
}
