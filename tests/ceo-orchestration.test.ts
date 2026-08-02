import { describe, expect, it } from "vitest";
import {
  parseCeoOrchestrationOutput,
  type CeoChildIssueDescriptor,
  type CeoOrchestrationGroup,
  type CeoOrchestrationScript,
} from "../src/local-console/ceo-orchestration-parser.js";

const scripts: CeoOrchestrationScript[] = [
  { id: "default-plan-chain", action: "route" },
  { id: "plan-review", action: "route" },
  {
    id: "milestone-spawn-child-issues",
    action: "spawn_child_issues",
  },
  {
    id: "roundtable-plan-review",
    action: "roundtable",
  },
  {
    id: "goal-intake",
    action: "goal_intake",
  },
];
const descriptor: CeoChildIssueDescriptor = {
  ledgerTaskId: "task-1",
  groupId: "g1",
  title: "Implement orchestration",
  description: "实现 CEO 编排路径。",
  initialRole: "dev",
  qualityBaseline: "data-correct",
  acceptanceStatements: ["跑 pnpm test → 应退出码 0"],
  dependencies: ["task-0"],
  provenance: "来自当前阶段 projection",
};
const group: CeoOrchestrationGroup = { id: "g1", reason: "同一模块串行" };

describe("CEO orchestration output parser", () => {
  it("accepts fenced JSON followed by an in-progress stage marker", () => {
    const output = `\`\`\`json
${JSON.stringify({
  action: "spawn_child_issues",
  workflowId: "milestone-spawn-child-issues",
  summary: "拆解完成",
  groups: [group],
  issues: [descriptor],
})}
\`\`\`

<!-- moebius:stage=in-progress -->`;

    expect(
      parseCeoOrchestrationOutput({
        output,
        scripts,
        availableAgentNames: ["dev", "qa", "product-manager"],
        visibleTaskIds: ["task-1"],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        action: "spawn_child_issues",
        workflowId: "milestone-spawn-child-issues",
      },
    });
  });

  it("keeps GitHub acceptance strict while allowing optional local task checks", () => {
    const base = {
      action: "spawn_child_issues",
      workflowId: "milestone-spawn-child-issues",
      summary: "拆解完成",
      groups: [group],
    };
    const withoutChecks = { ...descriptor, acceptanceStatements: undefined };
    const parse = (issue: unknown, childTaskCheckPolicy?: "local-optional") =>
      parseCeoOrchestrationOutput({
        output: `${JSON.stringify({ ...base, issues: [issue] })}\n\n<!-- moebius:stage=in-progress -->`,
        scripts,
        availableAgentNames: ["dev"],
        visibleTaskIds: ["task-1"],
        childTaskCheckPolicy,
      });

    expect(parse(withoutChecks)).toMatchObject({
      ok: false,
      reason: "issues.0.acceptanceStatements:invalid",
    });
    expect(parse(withoutChecks, "local-optional")).toMatchObject({
      ok: true,
      value: { issues: [{ acceptanceStatements: [] }] },
    });
    expect(parse({ ...withoutChecks, taskChecks: ["运行单元测试"] }, "local-optional")).toMatchObject({
      ok: true,
      value: { issues: [{ acceptanceStatements: ["运行单元测试"] }] },
    });
    expect(parse({ ...descriptor, taskChecks: ["另一个检查"] }, "local-optional")).toMatchObject({
      ok: false,
      reason: "issues.0.task-check-fields-conflict",
    });
  });

  it("rejects invalid JSON and does not produce descriptors", () => {
    expect(
      parseCeoOrchestrationOutput({
        output: "not json\n\n<!-- moebius:stage=in-progress -->",
        scripts,
        availableAgentNames: ["dev"],
        visibleTaskIds: ["task-1"],
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("invalid-json") });
  });

  it("accepts default-plan-chain route without visible ledger task ids", () => {
    const output = `${JSON.stringify({
      action: "route",
      workflowId: "default-plan-chain",
      body: "@dev 请按 OpenSpec 流程先采访再写方案。",
    })}

<!-- moebius:stage=in-progress -->`;

    expect(
      parseCeoOrchestrationOutput({
        output,
        scripts,
        availableAgentNames: ["dev", "ceo"],
        visibleTaskIds: [],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        action: "route",
        workflowId: "default-plan-chain",
      },
    });
  });

  it("rejects unknown workflow, invalid role, missing acceptance, and invisible task ids", () => {
    const base = {
      action: "spawn_child_issues",
      workflowId: "milestone-spawn-child-issues",
      summary: "拆解完成",
      groups: [group],
      issues: [descriptor],
    };
    const parse = (payload: unknown) =>
      parseCeoOrchestrationOutput({
        output: `${JSON.stringify(payload)}\n\n<!-- moebius:stage=in-progress -->`,
        scripts,
        availableAgentNames: ["dev"],
        visibleTaskIds: ["task-1"],
      });

    expect(parse({ ...base, workflowId: "missing" })).toMatchObject({ ok: false, reason: "unknown-workflow:missing" });
    expect(parse({ ...base, issues: [{ ...descriptor, initialRole: "ghost" }] })).toMatchObject({
      ok: false,
      reason: "invalid-initial-role:ghost",
    });
    expect(parse({ ...base, issues: [{ ...descriptor, acceptanceStatements: [] }] })).toMatchObject({
      ok: false,
      reason: "issues.0.acceptanceStatements:empty",
    });
    expect(parse({ ...base, issues: [{ ...descriptor, ledgerTaskId: "task-2" }] })).toMatchObject({
      ok: false,
      reason: "unknown-ledger-task:task-2",
    });
  });

  it("parses roundtable start, route, and complete outputs", () => {
    const participants = ["qa", "dev-manager", "hermes-user"];
    const parse = (payload: unknown) =>
      parseCeoOrchestrationOutput({
        output: `${JSON.stringify(payload)}\n\n<!-- moebius:stage=in-progress -->`,
        scripts,
        availableAgentNames: ["ceo", "qa", "dev-manager", "hermes-user"],
        visibleTaskIds: ["task-1"],
      });

    expect(
      parse({
        action: "roundtable",
        workflowId: "roundtable-plan-review",
        mode: "start",
        roundtableId: "rt-1",
        ledgerTaskId: "task-1",
        title: "Plan review roundtable",
        topic: "Review the plan",
        inputSummary: "Plan text",
        participants,
        firstRole: "qa",
        qualityBaseline: "data-correct",
        provenance: "parent issue",
      }),
    ).toMatchObject({ ok: true, value: { action: "roundtable", mode: "start" } });

    expect(
      parse({
        action: "roundtable",
        workflowId: "roundtable-plan-review",
        mode: "route",
        roundtableKey: "moebius-roundtable-key:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        participants,
        nextRole: "dev-manager",
        body: "@dev-manager 请发言。",
      }),
    ).toMatchObject({ ok: true, value: { action: "roundtable", mode: "route" } });

    expect(
      parse({
        action: "roundtable",
        workflowId: "roundtable-plan-review",
        mode: "complete",
        roundtableKey: "moebius-roundtable-key:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        participants,
        summary: "完成",
        contributions: participants.map((role) => ({
          role,
          position: `${role} position`,
          evidence: `${role} evidence`,
          disagreements: [],
        })),
        decision: "继续",
        provenance: "child issue",
      }),
    ).toMatchObject({ ok: true, value: { action: "roundtable", mode: "complete" } });
  });

  it("rejects invalid roundtable participants, route mentions, and incomplete contributions", () => {
    const participants = ["qa", "dev-manager", "hermes-user"];
    const parse = (payload: unknown, availableAgentNames = ["ceo", "qa", "dev-manager", "hermes-user"]) =>
      parseCeoOrchestrationOutput({
        output: `${JSON.stringify(payload)}\n\n<!-- moebius:stage=in-progress -->`,
        scripts,
        availableAgentNames,
        visibleTaskIds: ["task-1"],
      });

    const start = {
      action: "roundtable",
      workflowId: "roundtable-plan-review",
      mode: "start",
      roundtableId: "rt-1",
      ledgerTaskId: "task-1",
      title: "Plan review roundtable",
      topic: "Review the plan",
      inputSummary: "Plan text",
      participants,
      firstRole: "qa",
      qualityBaseline: "data-correct",
      provenance: "parent issue",
    };
    expect(parse(start, ["ceo", "dev-manager", "hermes-user"])).toMatchObject({
      ok: false,
      reason: "roundtable-participant-unavailable:qa",
    });
    expect(parse({ ...start, participants: ["qa", "qa", "dev-manager", "hermes-user"] })).toMatchObject({
      ok: false,
      reason: "roundtable-participant-duplicate:qa",
    });

    expect(
      parse({
        action: "roundtable",
        workflowId: "roundtable-plan-review",
        mode: "route",
        roundtableKey: "moebius-roundtable-key:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        participants,
        nextRole: "dev-manager",
        body: "@dev-manager @qa 请发言。",
      }),
    ).toMatchObject({ ok: false, reason: "roundtable-route-body-invalid-mention:dev-manager,qa" });

    expect(
      parse({
        action: "roundtable",
        workflowId: "roundtable-plan-review",
        mode: "complete",
        roundtableKey: "moebius-roundtable-key:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        participants,
        summary: "完成",
        contributions: [
          { role: "qa", position: "p", evidence: "e", disagreements: [] },
          { role: "dev-manager", position: "p", evidence: "e", disagreements: [] },
        ],
        decision: "继续",
        provenance: "child issue",
      }),
    ).toMatchObject({ ok: false, reason: "contribution-role-missing:hermes-user" });
  });

  it("parses goal-intake interview, propose, and confirm payloads", () => {
    const parse = (payload: unknown) =>
      parseCeoOrchestrationOutput({
        output: `${JSON.stringify(payload)}\n\n<!-- moebius:stage=in-progress -->`,
        scripts,
        availableAgentNames: ["ceo", "dev", "qa", "product-manager"],
        visibleTaskIds: [],
      });
    const proposalKey = "moebius-goal-intake-proposal-key:0123456789abcdef0123456789abcdef";

    expect(
      parse({
        action: "goal_intake",
        workflowId: "goal-intake",
        mode: "interview",
        body: "请先回答几个问题。",
        questions: ["目标用户是谁？", "第一阶段希望验收什么？"],
      }),
    ).toMatchObject({ ok: true, value: { action: "goal_intake", mode: "interview" } });

    expect(parse(makeGoalIntakeProposePayload())).toMatchObject({
      ok: true,
      value: { action: "goal_intake", mode: "propose", proposalId: "proposal-1" },
    });

    expect(
      parse({
        action: "goal_intake",
        workflowId: "goal-intake",
        mode: "confirm",
        proposalKey,
        summary: "用户确认阶段一。",
        groups: [{ id: "g1", reason: "阶段一串行推进。" }],
        issues: [
          makeGoalIntakeConfirmIssue("task-1"),
          makeGoalIntakeConfirmIssue("task-2"),
          makeGoalIntakeConfirmIssue("task-3"),
        ],
        provenance: "user confirmed proposal",
      }),
    ).toMatchObject({ ok: true, value: { action: "goal_intake", mode: "confirm", proposalKey } });

  });

  it("rejects unbounded goal-intake interviews, oversized task acceptance, and missing payment disclaimers", () => {
    const parse = (payload: unknown) =>
      parseCeoOrchestrationOutput({
        output: `${JSON.stringify(payload)}\n\n<!-- moebius:stage=in-progress -->`,
        scripts,
        availableAgentNames: ["ceo", "dev", "qa", "product-manager"],
        visibleTaskIds: [],
      });

    expect(
      parse({
        action: "goal_intake",
        workflowId: "goal-intake",
        mode: "interview",
        body: "请回答。",
        questions: ["1", "2", "3", "4", "5"],
      }),
    ).toMatchObject({ ok: false, reason: "goal-intake-interview-question-count:5" });

    expect(
      parse({
        ...makeGoalIntakeProposePayload(),
        tasks: [
          makeGoalIntakeTask("task-1"),
          makeGoalIntakeTask("task-2"),
          { ...makeGoalIntakeTask("task-3"), acceptanceStatements: ["a", "b", "c", "d"] },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "tasks.2.acceptanceStatements:count:4" });

    expect(
      parse({
        ...makeGoalIntakeProposePayload(),
        confirmationBody: "支付宝 demo 提案。",
      }),
    ).toMatchObject({ ok: false, reason: "goal-intake-payment-disclaimer-missing" });
  });

});

function makeGoalIntakeProposePayload() {
  return {
    action: "goal_intake",
    workflowId: "goal-intake",
    mode: "propose",
    proposalId: "proposal-1",
    assumptions: ["质量基准默认为 demo，用户确认提案即接受。"],
    goal: {
      id: "goal-pay-demo",
      title: "支付宝 demo",
      summary: "做一个支付宝风格 demo。",
      scope: "只做演示闭环。",
      acceptanceStatements: ["跑 pnpm test -- goal-intake → 应退出码 0"],
      dependencies: [],
      qualityBaseline: "demo",
    },
    milestones: [
      { id: "ms-1", title: "阶段一", qualityBaseline: "demo" },
      { id: "ms-2", title: "阶段二", qualityBaseline: "demo" },
    ],
    phaseOne: {
      id: "phase-1",
      name: "阶段一",
      objective: "完成 demo 入口。",
      acceptanceStatements: ["跑 pnpm test -- goal-intake → 应退出码 0"],
      dependencies: [],
      qualityBaseline: "demo",
    },
    tasks: [makeGoalIntakeTask("task-1"), makeGoalIntakeTask("task-2"), makeGoalIntakeTask("task-3")],
    confirmationBody: "这是支付宝 demo 提案；不承诺真实资金处理、金融牌照、清结算或结算能力。",
    provenance: "issue body goal intake",
  };
}

function makeGoalIntakeTask(id: string) {
  return {
    id,
    milestoneId: "ms-1",
    title: `任务 ${id}`,
    scope: `实现 ${id}`,
    initialRole: "dev",
    qualityBaseline: "demo",
    acceptanceStatements: [`跑 pnpm test -- ${id} → 应退出码 0`],
    dependencies: [],
    provenance: "phase-one proposal",
  };
}

function makeGoalIntakeConfirmIssue(taskId: string): CeoChildIssueDescriptor {
  return {
    ledgerTaskId: taskId,
    groupId: "g1",
    title: `任务 ${taskId}`,
    description: `实现 ${taskId}`,
    initialRole: "dev",
    qualityBaseline: "demo",
    acceptanceStatements: [`跑 pnpm test -- ${taskId} → 应退出码 0`],
    dependencies: [],
    provenance: "confirmed proposal",
  };
}
