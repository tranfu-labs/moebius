import { describe, expect, it } from "vitest";

import {
  AGENT_RECORDS,
  DELIVERY_TEAM,
  GENERAL_TEAM,
  IDLE_APPLY,
  MARKETING_TEAM,
  SESSION_SNAPSHOT,
  TEAM_CATALOG,
  USER_DELIVERY_TEAM,
  cancelApply,
  detectChanges,
  enqueueWaitingMessage,
  hasAnyChange,
  identityLabel,
  provenanceLabel,
  removeWaitingMessage,
  requestApply,
  retryApply,
  shouldNavigateAfterSaveAll,
  snapshotFromTeam,
  snapshotIdentity,
  summarizeSave,
  teamIdentity
} from "./team-model.js";

describe("identityLabel 同名辨认", () => {
  const peers = TEAM_CATALOG.map(teamIdentity);

  it("无重名时只显示名称与来源", () => {
    expect(identityLabel(teamIdentity(GENERAL_TEAM), peers)).toBe(
      "通用助手 · 官方来源"
    );
  });

  it("同名不同来源时靠来源区分", () => {
    expect(identityLabel(teamIdentity(DELIVERY_TEAM), peers)).toBe(
      "交付团队 · 官方来源"
    );
    expect(identityLabel(teamIdentity(USER_DELIVERY_TEAM), peers)).toBe(
      "交付团队 · 用户团队"
    );
  });

  it("名称与来源都相同时追加内置来源名称或创建时间", () => {
    const rivalOfficial = {
      name: "交付团队",
      source: "official" as const,
      builtinName: "内置：旧版交付团队"
    };
    const withCollision = [...peers, rivalOfficial];
    expect(identityLabel(teamIdentity(DELIVERY_TEAM), withCollision)).toBe(
      "交付团队 · 官方来源 · 内置：交付团队"
    );
    const rivalUser = {
      name: "交付团队",
      source: "user" as const,
      createdAt: "创建于 2026-08-01 10:00:00"
    };
    expect(
      identityLabel(teamIdentity(USER_DELIVERY_TEAM), [...peers, rivalUser])
    ).toBe("交付团队 · 用户团队 · 创建于 2026-07-29 14:32:05");
  });

  it("快照身份保留历史团队名称", () => {
    const label = identityLabel(snapshotIdentity(SESSION_SNAPSHOT), peers);
    expect(label.startsWith("开发团队 · 官方来源")).toBe(true);
  });
});

describe("detectChanges 分类变化检测", () => {
  const changes = detectChanges(SESSION_SNAPSHOT, DELIVERY_TEAM);

  it("AGENT.md 与运行配置分别计数", () => {
    expect(changes.agentDefinition).toBe(3);
    expect(changes.runtimeConfig).toBe(3);
  });

  it("团队改名或成员增删归为团队信息变化", () => {
    expect(changes.teamInfo).toBe(true);
  });

  it("快照与同一团队构建的新快照相比没有变化", () => {
    const fresh = snapshotFromTeam(DELIVERY_TEAM, "2026-08-04 15:00");
    expect(hasAnyChange(detectChanges(fresh, DELIVERY_TEAM))).toBe(false);
  });

  it("切换到的目标团队相对旧快照整体算变化入口", () => {
    expect(hasAnyChange(detectChanges(SESSION_SNAPSHOT, MARKETING_TEAM))).toBe(
      true
    );
  });
});

describe("apply 状态机", () => {
  it("没有旧工作时立即生效", () => {
    expect(requestApply(DELIVERY_TEAM, false).phase).toBe("applied");
  });

  it("有旧工作时冻结点击瞬间的完整团队版本并等待", () => {
    const state = requestApply(DELIVERY_TEAM, true);
    expect(state.phase).toBe("pending");
    if (state.phase !== "pending") throw new Error("unreachable");
    expect(state.frozen).not.toBe(DELIVERY_TEAM);
    expect(state.frozen.members.length).toBe(DELIVERY_TEAM.members.length);
  });

  it("点击后发送的消息进入可移除的等待队列", () => {
    let state = requestApply(DELIVERY_TEAM, true);
    state = enqueueWaitingMessage(state, { id: "m1", text: "继续收尾" });
    state = enqueueWaitingMessage(state, { id: "m2", text: "再看看" });
    if (state.phase !== "pending") throw new Error("unreachable");
    expect(state.queue.map((item) => item.id)).toEqual(["m1", "m2"]);
    state = removeWaitingMessage(state, "m1");
    if (state.phase !== "pending") throw new Error("unreachable");
    expect(state.queue.map((item) => item.id)).toEqual(["m2"]);
  });

  it("失败后重试仍使用第一次冻结的同一版本", () => {
    let state = requestApply(DELIVERY_TEAM, true);
    state = enqueueWaitingMessage(state, { id: "m1", text: "等待中" });
    const failed = state.phase === "pending" ? state : null;
    if (!failed) throw new Error("unreachable");
    const failedState = {
      phase: "failed" as const,
      frozen: failed.frozen,
      queue: failed.queue,
      reason: "落盘失败"
    };
    const retried = retryApply(failedState);
    if (retried.phase !== "pending") throw new Error("unreachable");
    expect(retried.frozen).toBe(failed.frozen);
    expect(retried.queue.map((item) => item.id)).toEqual(["m1"]);
  });

  it("取消应用释放等待消息并回到分类提示", () => {
    let state = requestApply(DELIVERY_TEAM, true);
    state = enqueueWaitingMessage(state, { id: "m1", text: "等待中" });
    const { state: next, released } = cancelApply(state);
    expect(next.phase).toBe("idle");
    expect(released.map((item) => item.id)).toEqual(["m1"]);
  });

  it("idle / applied 状态不受队列操作影响", () => {
    expect(
      enqueueWaitingMessage(IDLE_APPLY, { id: "m1", text: "x" })
    ).toBe(IDLE_APPLY);
    expect(removeWaitingMessage({ phase: "applied" }, "m1")).toEqual({
      phase: "applied"
    });
  });
});

describe("provenanceLabel 事实证明层级", () => {
  it("三种层级文案固定", () => {
    expect(provenanceLabel({ kind: "executed" })).toBe("实际执行配置");
    expect(provenanceLabel({ kind: "planned" })).toBe(
      "本次计划尝试 · 未开始执行"
    );
    expect(provenanceLabel({ kind: "bound" })).toBe(
      "本次绑定配置 · 是否开始未记录"
    );
  });

  it("fixture 覆盖三种层级，旧历史缺失字段为 null", () => {
    const kinds = new Set(AGENT_RECORDS.map((record) => record.provenance.kind));
    expect(kinds).toEqual(new Set(["executed", "planned", "bound"]));
    const legacy = AGENT_RECORDS.find(
      (record) => record.provenance.kind === "bound"
    );
    expect(legacy?.model).toBeNull();
    expect(legacy?.effort).toBeNull();
  });
});

describe("团队页保存反馈", () => {
  it("部分失败时不显示整体已保存", () => {
    const summary = summarizeSave([
      { slug: "dev", displayName: "开发工程师", ok: true },
      { slug: "qa", displayName: "测试工程师", ok: false, error: "写入被拒绝" }
    ]);
    expect(summary.savedAll).toBe(false);
    expect(summary.saved.map((item) => item.slug)).toEqual(["dev"]);
    expect(summary.failed.map((item) => item.slug)).toEqual(["qa"]);
  });

  it("保存全部并离开只在全部成功时导航", () => {
    expect(
      shouldNavigateAfterSaveAll(
        summarizeSave([
          { slug: "dev", displayName: "开发工程师", ok: true },
          { slug: "qa", displayName: "测试工程师", ok: true }
        ])
      )
    ).toBe(true);
    expect(
      shouldNavigateAfterSaveAll(
        summarizeSave([{ slug: "qa", displayName: "测试工程师", ok: false }])
      )
    ).toBe(false);
  });
});
