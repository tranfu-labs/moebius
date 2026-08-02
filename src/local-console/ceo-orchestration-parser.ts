import { parseAgentMentions } from "../conversation.js";
import { CEO_ORCHESTRATION_STAGE, parseTrailingStageMarker } from "../stages.js";

export { CEO_ORCHESTRATION_STAGE } from "../stages.js";

export interface CeoOrchestrationScript {
  id: string;
  action: string;
}

export interface CeoOrchestrationGroup {
  id: string;
  reason: string;
}

export interface CeoChildIssueDescriptor {
  ledgerTaskId: string;
  groupId: string;
  title: string;
  description: string;
  initialRole: string;
  qualityBaseline: "demo" | "data-correct" | "production";
  acceptanceStatements: string[];
  dependencies: string[];
  provenance: string;
}

export interface GoalIntakeGoalDescriptor {
  id: string;
  title: string;
  summary: string;
  scope: string;
  acceptanceStatements: string[];
  dependencies: string[];
  qualityBaseline: "demo" | "data-correct" | "production";
}

export interface GoalIntakeMilestoneDescriptor {
  id: string;
  title: string;
  qualityBaseline: "demo" | "data-correct" | "production";
}

export interface GoalIntakePhaseDescriptor {
  id: string;
  name: string;
  objective: string;
  acceptanceStatements: string[];
  dependencies: string[];
  qualityBaseline: "demo" | "data-correct" | "production";
}

export interface GoalIntakeTaskDescriptor {
  id: string;
  milestoneId: string;
  title: string;
  scope: string;
  initialRole: string;
  qualityBaseline: "demo" | "data-correct" | "production";
  acceptanceStatements: string[];
  dependencies: string[];
  provenance: string;
}

export interface CeoRoundtableContribution {
  role: string;
  position: string;
  evidence: string;
  disagreements: string[];
}

export type ParsedCeoOrchestration =
  | {
      action: "route";
      workflowId: string;
      body: string;
    }
  | {
      action: "fail";
      body: string;
    }
  | {
      action: "spawn_child_issues";
      workflowId: string;
      summary: string;
      groups: CeoOrchestrationGroup[];
      issues: CeoChildIssueDescriptor[];
    }
  | {
      action: "goal_intake";
      workflowId: string;
      mode: "interview";
      body: string;
      questions: string[];
    }
  | {
      action: "goal_intake";
      workflowId: string;
      mode: "propose";
      proposalId: string;
      assumptions: string[];
      goal: GoalIntakeGoalDescriptor;
      milestones: GoalIntakeMilestoneDescriptor[];
      phaseOne: GoalIntakePhaseDescriptor;
      tasks: GoalIntakeTaskDescriptor[];
      confirmationBody: string;
      provenance: string;
    }
  | {
      action: "goal_intake";
      workflowId: string;
      mode: "confirm";
      proposalKey: string;
      summary: string;
      groups: CeoOrchestrationGroup[];
      issues: CeoChildIssueDescriptor[];
      provenance: string;
    }
  | {
      action: "roundtable";
      workflowId: string;
      mode: "start";
      roundtableId: string;
      ledgerTaskId: string;
      title: string;
      topic: string;
      inputSummary: string;
      participants: string[];
      firstRole: string;
      qualityBaseline: "demo" | "data-correct" | "production";
      provenance: string;
    }
  | {
      action: "roundtable";
      workflowId: string;
      mode: "route";
      roundtableKey: string;
      participants: string[];
      nextRole: string;
      body: string;
    }
  | {
      action: "roundtable";
      workflowId: string;
      mode: "complete";
      roundtableKey: string;
      participants: string[];
      summary: string;
      contributions: CeoRoundtableContribution[];
      decision: string;
      provenance: string;
    };

export type ParseCeoOrchestrationResult =
  | { ok: true; value: ParsedCeoOrchestration }
  | { ok: false; reason: string };

export type CeoChildTaskCheckPolicy = "strict-acceptance" | "local-optional";

export function parseCeoOrchestrationOutput(input: {
  output: string;
  scripts: readonly CeoOrchestrationScript[];
  availableAgentNames: readonly string[];
  visibleTaskIds: readonly string[];
  childTaskCheckPolicy?: CeoChildTaskCheckPolicy;
}): ParseCeoOrchestrationResult {
  if (parseTrailingStageMarker(input.output, [CEO_ORCHESTRATION_STAGE]) !== CEO_ORCHESTRATION_STAGE) {
    return { ok: false, reason: "missing-in-progress-stage-marker" };
  }

  const rawJson = stripFencedJson(stripTrailingStageMarker(input.output).trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return { ok: false, reason: `invalid-json:${formatError(error)}` };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "invalid-json:root-not-object" };
  }

  const action = parsed["action"];
  if (action === "fail") {
    const body = getNonEmptyString(parsed["body"], "body");
    if (!body.ok) {
      return body;
    }
    return { ok: true, value: { action, body: ensureInProgressStage(body.value) } };
  }

  if (action !== "route" && action !== "spawn_child_issues" && action !== "roundtable" && action !== "goal_intake") {
    return { ok: false, reason: `unknown-action:${String(action)}` };
  }

  const workflowId = getNonEmptyString(parsed["workflowId"], "workflowId");
  if (!workflowId.ok) {
    return workflowId;
  }
  const script = input.scripts.find((candidate) => candidate.id === workflowId.value) ?? null;
  if (script === null) {
    return { ok: false, reason: `unknown-workflow:${workflowId.value}` };
  }
  if (script.action !== action) {
    return { ok: false, reason: `workflow-action-mismatch:${workflowId.value}` };
  }

  if (action === "roundtable") {
    return parseRoundtableAction({
      parsed,
      workflowId: workflowId.value,
      availableAgentNames: input.availableAgentNames,
      visibleTaskIds: input.visibleTaskIds,
    });
  }

  if (action === "goal_intake") {
    return parseGoalIntakeAction({
      parsed,
      workflowId: workflowId.value,
      availableAgentNames: input.availableAgentNames,
      childTaskCheckPolicy: input.childTaskCheckPolicy ?? "strict-acceptance",
    });
  }

  if (action === "route") {
    const body = getNonEmptyString(parsed["body"], "body");
    if (!body.ok) {
      return body;
    }
    const mentions = parseAgentMentions(body.value);
    if (mentions.length > 1) {
      return { ok: false, reason: "route-body-multiple-mentions" };
    }
    if (mentions[0] !== undefined && !input.availableAgentNames.includes(mentions[0].name)) {
      return { ok: false, reason: `route-body-unknown-mention:${mentions[0].name}` };
    }
    return { ok: true, value: { action, workflowId: workflowId.value, body: ensureInProgressStage(body.value) } };
  }

  const summary = getNonEmptyString(parsed["summary"], "summary");
  if (!summary.ok) {
    return summary;
  }
  const groups = parseGroups(parsed["groups"]);
  if (!groups.ok) {
    return groups;
  }
  const issues = parseChildIssueDescriptors({
    value: parsed["issues"],
    groups: groups.value,
    availableAgentNames: input.availableAgentNames,
    visibleTaskIds: input.visibleTaskIds,
    requireVisibleTaskIds: true,
    taskCheckPolicy: input.childTaskCheckPolicy ?? "strict-acceptance",
  });
  if (!issues.ok) {
    return issues;
  }

  return {
    ok: true,
    value: {
      action,
      workflowId: workflowId.value,
      summary: summary.value,
      groups: groups.value,
      issues: issues.value,
    },
  };
}

export function extractGoalIntakeProposalKey(text: string | undefined): string | null {
  if (text === undefined) {
    return null;
  }
  const match = text.match(/moebius-goal-intake-proposal-key:[a-f0-9]{32}/u);
  return match?.[0] ?? null;
}

export function ensureInProgressStage(body: string): string {
  if (parseTrailingStageMarker(body, [CEO_ORCHESTRATION_STAGE]) === CEO_ORCHESTRATION_STAGE) {
    return body.trimEnd();
  }

  return `${body.trimEnd()}\n\n<!-- moebius:stage=${CEO_ORCHESTRATION_STAGE} -->`;
}

function parseRoundtableAction(input: {
  parsed: Record<string, unknown>;
  workflowId: string;
  availableAgentNames: readonly string[];
  visibleTaskIds: readonly string[];
}): ParseCeoOrchestrationResult {
  const mode = getNonEmptyString(input.parsed["mode"], "mode");
  if (!mode.ok) {
    return mode;
  }
  const participants = getNonEmptyStringArray(input.parsed["participants"], "participants");
  if (!participants.ok) {
    return participants;
  }
  const participantValidation = validateRoundtableParticipants(participants.value, input.availableAgentNames);
  if (!participantValidation.ok) {
    return participantValidation;
  }

  if (mode.value === "start") {
    const roundtableId = getNonEmptyString(input.parsed["roundtableId"], "roundtableId");
    const ledgerTaskId = getNonEmptyString(input.parsed["ledgerTaskId"], "ledgerTaskId");
    const title = getNonEmptyString(input.parsed["title"], "title");
    const topic = getNonEmptyString(input.parsed["topic"], "topic");
    const inputSummary = getNonEmptyString(input.parsed["inputSummary"], "inputSummary");
    const firstRole = getNonEmptyString(input.parsed["firstRole"], "firstRole");
    const qualityBaseline = getNonEmptyString(input.parsed["qualityBaseline"], "qualityBaseline");
    const provenance = getNonEmptyString(input.parsed["provenance"], "provenance");
    if (!roundtableId.ok) {
      return roundtableId;
    }
    if (!ledgerTaskId.ok) {
      return ledgerTaskId;
    }
    if (!title.ok) {
      return title;
    }
    if (!topic.ok) {
      return topic;
    }
    if (!inputSummary.ok) {
      return inputSummary;
    }
    if (!firstRole.ok) {
      return firstRole;
    }
    if (!qualityBaseline.ok) {
      return qualityBaseline;
    }
    if (!provenance.ok) {
      return provenance;
    }
    if (!input.visibleTaskIds.includes(ledgerTaskId.value)) {
      return { ok: false, reason: `unknown-ledger-task:${ledgerTaskId.value}` };
    }
    if (firstRole.value !== participants.value[0]) {
      return { ok: false, reason: `roundtable-first-role-mismatch:${firstRole.value}` };
    }
    if (!isQualityBaseline(qualityBaseline.value)) {
      return { ok: false, reason: `invalid-quality-baseline:${qualityBaseline.value}` };
    }
    return {
      ok: true,
      value: {
        action: "roundtable",
        workflowId: input.workflowId,
        mode: "start",
        roundtableId: roundtableId.value,
        ledgerTaskId: ledgerTaskId.value,
        title: title.value,
        topic: topic.value,
        inputSummary: inputSummary.value,
        participants: participants.value,
        firstRole: firstRole.value,
        qualityBaseline: qualityBaseline.value,
        provenance: provenance.value,
      },
    };
  }

  if (mode.value === "route") {
    const roundtableKey = getNonEmptyString(input.parsed["roundtableKey"], "roundtableKey");
    const nextRole = getNonEmptyString(input.parsed["nextRole"], "nextRole");
    const body = getNonEmptyString(input.parsed["body"], "body");
    if (!roundtableKey.ok) {
      return roundtableKey;
    }
    if (!nextRole.ok) {
      return nextRole;
    }
    if (!body.ok) {
      return body;
    }
    if (!participants.value.includes(nextRole.value)) {
      return { ok: false, reason: `roundtable-next-role-not-participant:${nextRole.value}` };
    }
    const mentions = parseAgentMentions(body.value);
    if (mentions.length !== 1 || mentions[0]?.name !== nextRole.value) {
      return { ok: false, reason: `roundtable-route-body-invalid-mention:${mentions.map((mention) => mention.name).join(",")}` };
    }
    return {
      ok: true,
      value: {
        action: "roundtable",
        workflowId: input.workflowId,
        mode: "route",
        roundtableKey: roundtableKey.value,
        participants: participants.value,
        nextRole: nextRole.value,
        body: body.value,
      },
    };
  }

  if (mode.value === "complete") {
    const roundtableKey = getNonEmptyString(input.parsed["roundtableKey"], "roundtableKey");
    const summary = getNonEmptyString(input.parsed["summary"], "summary");
    const decision = getNonEmptyString(input.parsed["decision"], "decision");
    const provenance = getNonEmptyString(input.parsed["provenance"], "provenance");
    if (!roundtableKey.ok) {
      return roundtableKey;
    }
    if (!summary.ok) {
      return summary;
    }
    if (!decision.ok) {
      return decision;
    }
    if (!provenance.ok) {
      return provenance;
    }
    const contributions = parseRoundtableContributions(input.parsed["contributions"], participants.value);
    if (!contributions.ok) {
      return contributions;
    }
    return {
      ok: true,
      value: {
        action: "roundtable",
        workflowId: input.workflowId,
        mode: "complete",
        roundtableKey: roundtableKey.value,
        participants: participants.value,
        summary: summary.value,
        contributions: contributions.value,
        decision: decision.value,
        provenance: provenance.value,
      },
    };
  }

  return { ok: false, reason: `roundtable-unknown-mode:${mode.value}` };
}

function parseGoalIntakeAction(input: {
  parsed: Record<string, unknown>;
  workflowId: string;
  availableAgentNames: readonly string[];
  childTaskCheckPolicy: CeoChildTaskCheckPolicy;
}): ParseCeoOrchestrationResult {
  const mode = getNonEmptyString(input.parsed["mode"], "mode");
  if (!mode.ok) {
    return mode;
  }

  if (mode.value === "interview") {
    const body = getNonEmptyString(input.parsed["body"], "body");
    if (!body.ok) {
      return body;
    }
    const questions = getNonEmptyStringArray(input.parsed["questions"], "questions");
    if (!questions.ok) {
      return questions;
    }
    if (questions.value.length < 2 || questions.value.length > 4) {
      return { ok: false, reason: `goal-intake-interview-question-count:${String(questions.value.length)}` };
    }
    const mentions = parseAgentMentions(body.value);
    if (mentions.length > 1) {
      return { ok: false, reason: "goal-intake-interview-body-multiple-mentions" };
    }
    if (mentions[0] !== undefined && !input.availableAgentNames.includes(mentions[0].name)) {
      return { ok: false, reason: `goal-intake-interview-body-unknown-mention:${mentions[0].name}` };
    }
    return {
      ok: true,
      value: {
        action: "goal_intake",
        workflowId: input.workflowId,
        mode: "interview",
        body: ensureInProgressStage(body.value),
        questions: questions.value,
      },
    };
  }

  if (mode.value === "propose") {
    const proposalId = getNonEmptyString(input.parsed["proposalId"], "proposalId");
    const assumptions = getStringArray(input.parsed["assumptions"], "assumptions");
    const goal = parseGoalIntakeGoal(input.parsed["goal"]);
    const milestones = parseGoalIntakeMilestones(input.parsed["milestones"]);
    const phaseOne = parseGoalIntakePhase(input.parsed["phaseOne"]);
    const tasks = parseGoalIntakeTasks(input.parsed["tasks"], {
      availableAgentNames: input.availableAgentNames,
      milestoneIds: milestones.ok ? milestones.value.map((milestone) => milestone.id) : [],
    });
    const confirmationBody = getNonEmptyString(input.parsed["confirmationBody"], "confirmationBody");
    const provenance = getNonEmptyString(input.parsed["provenance"], "provenance");
    if (!proposalId.ok) {
      return proposalId;
    }
    if (!assumptions.ok) {
      return assumptions;
    }
    if (!goal.ok) {
      return goal;
    }
    if (!milestones.ok) {
      return milestones;
    }
    if (!phaseOne.ok) {
      return phaseOne;
    }
    if (!tasks.ok) {
      return tasks;
    }
    if (!confirmationBody.ok) {
      return confirmationBody;
    }
    if (!provenance.ok) {
      return provenance;
    }
    if (milestones.value.length < 2 || milestones.value.length > 5) {
      return { ok: false, reason: `goal-intake-milestone-count:${String(milestones.value.length)}` };
    }
    if (tasks.value.length < 3 || tasks.value.length > 7) {
      return { ok: false, reason: `goal-intake-task-count:${String(tasks.value.length)}` };
    }
    if (!containsPaymentDisclaimer(JSON.stringify(input.parsed))) {
      return { ok: false, reason: "goal-intake-payment-disclaimer-missing" };
    }

    return {
      ok: true,
      value: {
        action: "goal_intake",
        workflowId: input.workflowId,
        mode: "propose",
        proposalId: proposalId.value,
        assumptions: assumptions.value,
        goal: goal.value,
        milestones: milestones.value,
        phaseOne: phaseOne.value,
        tasks: tasks.value,
        confirmationBody: confirmationBody.value,
        provenance: provenance.value,
      },
    };
  }

  if (mode.value === "confirm") {
    const proposalKey = getNonEmptyString(input.parsed["proposalKey"], "proposalKey");
    const summary = getNonEmptyString(input.parsed["summary"], "summary");
    const provenance = getNonEmptyString(input.parsed["provenance"], "provenance");
    if (!proposalKey.ok) {
      return proposalKey;
    }
    if (!summary.ok) {
      return summary;
    }
    if (!provenance.ok) {
      return provenance;
    }
    if (extractGoalIntakeProposalKey(proposalKey.value) !== proposalKey.value) {
      return { ok: false, reason: `invalid-goal-intake-proposal-key:${proposalKey.value}` };
    }
    const groups = parseGroups(input.parsed["groups"]);
    if (!groups.ok) {
      return groups;
    }
    const issues = parseChildIssueDescriptors({
      value: input.parsed["issues"],
      groups: groups.value,
      availableAgentNames: input.availableAgentNames,
      visibleTaskIds: [],
      requireVisibleTaskIds: false,
      taskCheckPolicy: input.childTaskCheckPolicy,
      ...(input.childTaskCheckPolicy === "strict-acceptance" ? { acceptanceCount: { min: 1, max: 3 } } : {}),
    });
    if (!issues.ok) {
      return issues;
    }
    return {
      ok: true,
      value: {
        action: "goal_intake",
        workflowId: input.workflowId,
        mode: "confirm",
        proposalKey: proposalKey.value,
        summary: summary.value,
        groups: groups.value,
        issues: issues.value,
        provenance: provenance.value,
      },
    };
  }

  return { ok: false, reason: `goal-intake-unknown-mode:${mode.value}` };
}

function stripTrailingStageMarker(output: string): string {
  return output.replace(/\s*<!--\s*moebius:stage=in-progress\s*-->\s*$/u, "");
}

function stripFencedJson(text: string): string {
  const fenced = text.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/u);
  return fenced?.[1]?.trim() ?? text;
}

function parseGroups(value: unknown): { ok: true; value: CeoOrchestrationGroup[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: "groups-empty" };
  }
  const result: CeoOrchestrationGroup[] = [];
  const seen = new Set<string>();
  for (const [index, group] of value.entries()) {
    if (!isPlainObject(group)) {
      return { ok: false, reason: `groups.${String(index)}:not-object` };
    }
    const id = getNonEmptyString(group["id"], `groups.${String(index)}.id`);
    if (!id.ok) {
      return id;
    }
    const reason = getNonEmptyString(group["reason"], `groups.${String(index)}.reason`);
    if (!reason.ok) {
      return reason;
    }
    if (seen.has(id.value)) {
      return { ok: false, reason: `duplicate-group:${id.value}` };
    }
    seen.add(id.value);
    result.push({ id: id.value, reason: reason.value });
  }
  return { ok: true, value: result };
}

function parseGoalIntakeGoal(value: unknown): { ok: true; value: GoalIntakeGoalDescriptor } | { ok: false; reason: string } {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "goal:not-object" };
  }
  const id = getNonEmptyString(value["id"], "goal.id");
  const title = getNonEmptyString(value["title"], "goal.title");
  const summary = getNonEmptyString(value["summary"], "goal.summary");
  const scope = getNonEmptyString(value["scope"], "goal.scope");
  const acceptanceStatements = getBoundedNonEmptyStringArray(value["acceptanceStatements"], "goal.acceptanceStatements", 1, 5);
  const dependencies = getStringArray(value["dependencies"], "goal.dependencies");
  const qualityBaseline = getNonEmptyString(value["qualityBaseline"], "goal.qualityBaseline");
  if (!id.ok) {
    return id;
  }
  if (!title.ok) {
    return title;
  }
  if (!summary.ok) {
    return summary;
  }
  if (!scope.ok) {
    return scope;
  }
  if (!acceptanceStatements.ok) {
    return acceptanceStatements;
  }
  if (!dependencies.ok) {
    return dependencies;
  }
  if (!qualityBaseline.ok) {
    return qualityBaseline;
  }
  if (!isQualityBaseline(qualityBaseline.value)) {
    return { ok: false, reason: `invalid-quality-baseline:${qualityBaseline.value}` };
  }
  return {
    ok: true,
    value: {
      id: id.value,
      title: title.value,
      summary: summary.value,
      scope: scope.value,
      acceptanceStatements: acceptanceStatements.value,
      dependencies: dependencies.value,
      qualityBaseline: qualityBaseline.value,
    },
  };
}

function parseGoalIntakeMilestones(value: unknown): { ok: true; value: GoalIntakeMilestoneDescriptor[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "milestones:invalid" };
  }
  const result: GoalIntakeMilestoneDescriptor[] = [];
  const seen = new Set<string>();
  for (const [index, milestone] of value.entries()) {
    const path = `milestones.${String(index)}`;
    if (!isPlainObject(milestone)) {
      return { ok: false, reason: `${path}:not-object` };
    }
    const id = getNonEmptyString(milestone["id"], `${path}.id`);
    const title = getNonEmptyString(milestone["title"], `${path}.title`);
    const qualityBaseline = getNonEmptyString(milestone["qualityBaseline"], `${path}.qualityBaseline`);
    if (!id.ok) {
      return id;
    }
    if (!title.ok) {
      return title;
    }
    if (!qualityBaseline.ok) {
      return qualityBaseline;
    }
    if (seen.has(id.value)) {
      return { ok: false, reason: `duplicate-milestone:${id.value}` };
    }
    if (!isQualityBaseline(qualityBaseline.value)) {
      return { ok: false, reason: `invalid-quality-baseline:${qualityBaseline.value}` };
    }
    seen.add(id.value);
    result.push({ id: id.value, title: title.value, qualityBaseline: qualityBaseline.value });
  }
  return { ok: true, value: result };
}

function parseGoalIntakePhase(value: unknown): { ok: true; value: GoalIntakePhaseDescriptor } | { ok: false; reason: string } {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "phaseOne:not-object" };
  }
  const id = getNonEmptyString(value["id"], "phaseOne.id");
  const name = getNonEmptyString(value["name"], "phaseOne.name");
  const objective = getNonEmptyString(value["objective"], "phaseOne.objective");
  const acceptanceStatements = getBoundedNonEmptyStringArray(value["acceptanceStatements"], "phaseOne.acceptanceStatements", 1, 5);
  const dependencies = getStringArray(value["dependencies"], "phaseOne.dependencies");
  const qualityBaseline = getNonEmptyString(value["qualityBaseline"], "phaseOne.qualityBaseline");
  if (!id.ok) {
    return id;
  }
  if (!name.ok) {
    return name;
  }
  if (!objective.ok) {
    return objective;
  }
  if (!acceptanceStatements.ok) {
    return acceptanceStatements;
  }
  if (!dependencies.ok) {
    return dependencies;
  }
  if (!qualityBaseline.ok) {
    return qualityBaseline;
  }
  if (!isQualityBaseline(qualityBaseline.value)) {
    return { ok: false, reason: `invalid-quality-baseline:${qualityBaseline.value}` };
  }
  return {
    ok: true,
    value: {
      id: id.value,
      name: name.value,
      objective: objective.value,
      acceptanceStatements: acceptanceStatements.value,
      dependencies: dependencies.value,
      qualityBaseline: qualityBaseline.value,
    },
  };
}

function parseGoalIntakeTasks(
  value: unknown,
  options: { availableAgentNames: readonly string[]; milestoneIds: readonly string[] },
): { ok: true; value: GoalIntakeTaskDescriptor[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "tasks:invalid" };
  }
  const milestoneIds = new Set(options.milestoneIds);
  const seen = new Set<string>();
  const result: GoalIntakeTaskDescriptor[] = [];
  for (const [index, task] of value.entries()) {
    const path = `tasks.${String(index)}`;
    if (!isPlainObject(task)) {
      return { ok: false, reason: `${path}:not-object` };
    }
    const id = getNonEmptyString(task["id"] ?? task["ledgerTaskId"], `${path}.id`);
    const milestoneId = getNonEmptyString(task["milestoneId"], `${path}.milestoneId`);
    const title = getNonEmptyString(task["title"], `${path}.title`);
    const scope = getNonEmptyString(task["scope"] ?? task["description"], `${path}.scope`);
    const initialRole = getNonEmptyString(task["initialRole"], `${path}.initialRole`);
    const qualityBaseline = getNonEmptyString(task["qualityBaseline"], `${path}.qualityBaseline`);
    const acceptanceStatements = getBoundedNonEmptyStringArray(task["acceptanceStatements"], `${path}.acceptanceStatements`, 1, 3);
    const dependencies = getStringArray(task["dependencies"], `${path}.dependencies`);
    const provenance = getNonEmptyString(task["provenance"], `${path}.provenance`);
    if (!id.ok) {
      return id;
    }
    if (!milestoneId.ok) {
      return milestoneId;
    }
    if (!title.ok) {
      return title;
    }
    if (!scope.ok) {
      return scope;
    }
    if (!initialRole.ok) {
      return initialRole;
    }
    if (!qualityBaseline.ok) {
      return qualityBaseline;
    }
    if (!acceptanceStatements.ok) {
      return acceptanceStatements;
    }
    if (!dependencies.ok) {
      return dependencies;
    }
    if (!provenance.ok) {
      return provenance;
    }
    if (seen.has(id.value)) {
      return { ok: false, reason: `duplicate-goal-intake-task:${id.value}` };
    }
    if (!milestoneIds.has(milestoneId.value)) {
      return { ok: false, reason: `unknown-goal-intake-milestone:${milestoneId.value}` };
    }
    if (!options.availableAgentNames.includes(initialRole.value)) {
      return { ok: false, reason: `invalid-initial-role:${initialRole.value}` };
    }
    if (!isQualityBaseline(qualityBaseline.value)) {
      return { ok: false, reason: `invalid-quality-baseline:${qualityBaseline.value}` };
    }
    seen.add(id.value);
    result.push({
      id: id.value,
      milestoneId: milestoneId.value,
      title: title.value,
      scope: scope.value,
      initialRole: initialRole.value,
      qualityBaseline: qualityBaseline.value,
      acceptanceStatements: acceptanceStatements.value,
      dependencies: dependencies.value,
      provenance: provenance.value,
    });
  }
  return { ok: true, value: result };
}

function parseChildIssueDescriptors(input: {
  value: unknown;
  groups: readonly CeoOrchestrationGroup[];
  availableAgentNames: readonly string[];
  visibleTaskIds: readonly string[];
  requireVisibleTaskIds: boolean;
  acceptanceCount?: { min: number; max: number };
  taskCheckPolicy: CeoChildTaskCheckPolicy;
}): { ok: true; value: CeoChildIssueDescriptor[] } | { ok: false; reason: string } {
  if (!Array.isArray(input.value) || input.value.length === 0) {
    return { ok: false, reason: "issues-empty" };
  }
  const groupIds = new Set(input.groups.map((group) => group.id));
  const taskIds = new Set(input.visibleTaskIds);
  const seenTaskIds = new Set<string>();
  const result: CeoChildIssueDescriptor[] = [];

  for (const [index, descriptor] of input.value.entries()) {
    const path = `issues.${String(index)}`;
    if (!isPlainObject(descriptor)) {
      return { ok: false, reason: `${path}:not-object` };
    }

    const ledgerTaskId = getNonEmptyString(descriptor["ledgerTaskId"], `${path}.ledgerTaskId`);
    if (!ledgerTaskId.ok) {
      return ledgerTaskId;
    }
    if (input.requireVisibleTaskIds && !taskIds.has(ledgerTaskId.value)) {
      return { ok: false, reason: `unknown-ledger-task:${ledgerTaskId.value}` };
    }
    if (seenTaskIds.has(ledgerTaskId.value)) {
      return { ok: false, reason: `duplicate-ledger-task:${ledgerTaskId.value}` };
    }
    seenTaskIds.add(ledgerTaskId.value);

    const groupId = getNonEmptyString(descriptor["groupId"], `${path}.groupId`);
    if (!groupId.ok) {
      return groupId;
    }
    if (!groupIds.has(groupId.value)) {
      return { ok: false, reason: `unknown-group:${groupId.value}` };
    }

    const title = getNonEmptyString(descriptor["title"], `${path}.title`);
    if (!title.ok) {
      return title;
    }
    const description = getNonEmptyString(descriptor["description"], `${path}.description`);
    if (!description.ok) {
      return description;
    }
    const initialRole = getNonEmptyString(descriptor["initialRole"], `${path}.initialRole`);
    if (!initialRole.ok) {
      return initialRole;
    }
    const qualityBaseline = getNonEmptyString(descriptor["qualityBaseline"], `${path}.qualityBaseline`);
    if (!qualityBaseline.ok) {
      return qualityBaseline;
    }
    const provenance = getNonEmptyString(descriptor["provenance"], `${path}.provenance`);
    if (!provenance.ok) {
      return provenance;
    }
    const initialRoleValue = initialRole.value;
    const qualityBaselineValue = qualityBaseline.value;
    if (!input.availableAgentNames.includes(initialRoleValue)) {
      return { ok: false, reason: `invalid-initial-role:${initialRoleValue}` };
    }
    if (!isQualityBaseline(qualityBaselineValue)) {
      return { ok: false, reason: `invalid-quality-baseline:${qualityBaselineValue}` };
    }

    const acceptanceStatements = parseChildTaskChecks(descriptor, path, input.taskCheckPolicy);
    if (!acceptanceStatements.ok) {
      return acceptanceStatements;
    }
    if (
      input.acceptanceCount !== undefined &&
      (acceptanceStatements.value.length < input.acceptanceCount.min ||
        acceptanceStatements.value.length > input.acceptanceCount.max)
    ) {
      return {
        ok: false,
        reason: `${path}.acceptanceStatements:count:${String(acceptanceStatements.value.length)}`,
      };
    }
    const dependencies = getStringArray(descriptor["dependencies"], `${path}.dependencies`);
    if (!dependencies.ok) {
      return dependencies;
    }

    result.push({
      ledgerTaskId: ledgerTaskId.value,
      groupId: groupId.value,
      title: title.value,
      description: description.value,
      initialRole: initialRoleValue,
      qualityBaseline: qualityBaselineValue,
      acceptanceStatements: acceptanceStatements.value,
      dependencies: dependencies.value,
      provenance: provenance.value,
    });
  }

  return { ok: true, value: result };
}

function parseChildTaskChecks(
  descriptor: Record<string, unknown>,
  path: string,
  policy: CeoChildTaskCheckPolicy,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (policy === "strict-acceptance") {
    return getNonEmptyStringArray(descriptor["acceptanceStatements"], `${path}.acceptanceStatements`);
  }

  const taskChecksValue = descriptor["taskChecks"];
  const legacyValue = descriptor["acceptanceStatements"];
  if (taskChecksValue === undefined && legacyValue === undefined) {
    return { ok: true, value: [] };
  }

  const taskChecks = taskChecksValue === undefined
    ? null
    : getBoundedNonEmptyStringArray(taskChecksValue, `${path}.taskChecks`, 1, 3);
  if (taskChecks !== null && !taskChecks.ok) {
    return taskChecks;
  }
  const legacy = legacyValue === undefined
    ? null
    : getBoundedNonEmptyStringArray(legacyValue, `${path}.acceptanceStatements`, 1, 3);
  if (legacy !== null && !legacy.ok) {
    return legacy;
  }
  if (
    taskChecks !== null &&
    legacy !== null &&
    JSON.stringify(taskChecks.value) !== JSON.stringify(legacy.value)
  ) {
    return { ok: false, reason: `${path}.task-check-fields-conflict` };
  }
  return { ok: true, value: taskChecks?.value ?? legacy?.value ?? [] };
}

function validateRoundtableParticipants(
  participants: readonly string[],
  availableAgentNames: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  const available = new Set(availableAgentNames);
  const seen = new Set<string>();
  for (const participant of participants) {
    if (!available.has(participant)) {
      return { ok: false, reason: `roundtable-participant-unavailable:${participant}` };
    }
    if (seen.has(participant)) {
      return { ok: false, reason: `roundtable-participant-duplicate:${participant}` };
    }
    seen.add(participant);
  }
  for (const required of ["qa", "dev-manager", "hermes-user"]) {
    if (!seen.has(required)) {
      return { ok: false, reason: `roundtable-required-participant-missing:${required}` };
    }
  }
  return { ok: true };
}

function parseRoundtableContributions(
  value: unknown,
  participants: readonly string[],
): { ok: true; value: CeoRoundtableContribution[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "contributions:invalid" };
  }
  const participantSet = new Set(participants);
  const seen = new Set<string>();
  const result: CeoRoundtableContribution[] = [];
  for (const [index, contribution] of value.entries()) {
    const path = `contributions.${String(index)}`;
    if (!isPlainObject(contribution)) {
      return { ok: false, reason: `${path}:not-object` };
    }
    const role = getNonEmptyString(contribution["role"], `${path}.role`);
    const position = getNonEmptyString(contribution["position"], `${path}.position`);
    const evidence = getNonEmptyString(contribution["evidence"], `${path}.evidence`);
    const disagreements = getStringArray(contribution["disagreements"], `${path}.disagreements`);
    if (!role.ok) {
      return role;
    }
    if (!position.ok) {
      return position;
    }
    if (!evidence.ok) {
      return evidence;
    }
    if (!disagreements.ok) {
      return disagreements;
    }
    if (!participantSet.has(role.value)) {
      return { ok: false, reason: `contribution-role-not-participant:${role.value}` };
    }
    if (seen.has(role.value)) {
      return { ok: false, reason: `contribution-role-duplicate:${role.value}` };
    }
    seen.add(role.value);
    result.push({
      role: role.value,
      position: position.value,
      evidence: evidence.value,
      disagreements: disagreements.value,
    });
  }
  const missing = participants.filter((participant) => !seen.has(participant));
  if (missing.length > 0) {
    return { ok: false, reason: `contribution-role-missing:${missing.join(",")}` };
  }
  return { ok: true, value: result };
}

function getNonEmptyString(value: unknown, path: string): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, reason: `${path}:missing` };
  }
  return { ok: true, value: value.trim() };
}

function getStringArray(value: unknown, path: string): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return { ok: false, reason: `${path}:invalid` };
  }
  return { ok: true, value: value.map((item) => item.trim()).filter((item) => item !== "") };
}

function getNonEmptyStringArray(
  value: unknown,
  path: string,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  const parsed = getStringArray(value, path);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.length === 0) {
    return { ok: false, reason: `${path}:empty` };
  }
  return parsed;
}

function getBoundedNonEmptyStringArray(
  value: unknown,
  path: string,
  min: number,
  max: number,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  const parsed = getNonEmptyStringArray(value, path);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.length < min || parsed.value.length > max) {
    return { ok: false, reason: `${path}:count:${String(parsed.value.length)}` };
  }
  return parsed;
}

function containsPaymentDisclaimer(text: string): boolean {
  const normalized = text.replace(/\s+/gu, "");
  if (!/(支付宝|支付|真实资金|清结算|清算|结算|牌照)/u.test(normalized)) {
    return true;
  }
  const hasNegativeScope = /(不承诺|不覆盖|不包含|不处理|不做|不支持|不涉及|不代表)/u.test(normalized);
  const hasRealFunds = /真实资金/u.test(normalized);
  const hasLicense = /牌照/u.test(normalized);
  const hasClearing = /(清结算|清算|结算)/u.test(normalized);
  return hasNegativeScope && hasRealFunds && hasLicense && hasClearing;
}

function isQualityBaseline(value: string): value is "demo" | "data-correct" | "production" {
  return value === "demo" || value === "data-correct" || value === "production";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

