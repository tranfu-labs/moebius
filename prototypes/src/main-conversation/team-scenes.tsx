/**
 * 团队菜单、变化提示与「应用」、头像信息卡、团队保存反馈四个场景。
 * 视觉投影 packages/console-ui 的现有模式（首字头像、来源徽标、紧凑信息卡、
 * 状态语义），但不 import 生产代码；数据全部来自 team-model.ts 的本地 fixture。
 * 设计原型，非正式产品实现。
 */

import {
  Check,
  ChevronDown,
  CircleAlert,
  Diamond,
  FileText,
  Folder,
  Info,
  Loader,
  Plus,
  SendHorizontal,
  Users,
  X
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  AGENT_RECORDS,
  type AgentRecord,
  type ApplyState,
  DELIVERY_TEAM,
  type MemberTone,
  type QueuedMessage,
  SESSION_SNAPSHOT,
  TEAM_CATALOG,
  type Team,
  type TeamMember,
  type TeamSnapshot,
  cancelApply,
  detectChanges,
  enqueueWaitingMessage,
  hasAnyChange,
  identityLabel,
  memberBySlug,
  provenanceLabel,
  removeWaitingMessage,
  requestApply,
  retryApply,
  settlePending,
  shouldNavigateAfterSaveAll,
  snapshotFromTeam,
  snapshotIdentity,
  sourceLabel,
  summarizeSave,
  teamIdentity,
  type SaveItemOutcome
} from "./team-model.js";

const APPLY_LOADED_AT = "2026-08-04 15:26";

/* ------------------------------------------------------------------ */
/* 共享小部件                                                          */
/* ------------------------------------------------------------------ */

function glyphOf(member: TeamMember): string {
  return Array.from(member.displayName)[0] ?? "A";
}

export function MemberAvatar({
  member,
  size = "compact"
}: {
  member: TeamMember;
  size?: "compact" | "heading";
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`member-avatar member-avatar-${size}`}
      data-tone={member.tone}
    >
      {glyphOf(member)}
    </span>
  );
}

function SourceBadge({ source }: { source: "official" | "user" }): JSX.Element {
  return (
    <span className="source-badge" data-source={source}>
      {sourceLabel(source)}
    </span>
  );
}

function disambiguationExtra(
  identity: { name: string; source: "official" | "user"; builtinName?: string; createdAt?: string },
  peers: ReturnType<typeof teamIdentity>[]
): string | null {
  const label = identityLabel(identity, peers);
  const base = `${identity.name} · ${sourceLabel(identity.source)}`;
  return label.length > base.length ? label.slice(base.length + 3) : null;
}

/* ------------------------------------------------------------------ */
/* 场景一：团队菜单                                                    */
/* ------------------------------------------------------------------ */

export function TeamMenuScene({
  mode,
  hasOldWork,
  onAnnounce
}: {
  mode: "new" | "existing";
  hasOldWork: boolean;
  onAnnounce: (text: string) => void;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<TeamSnapshot>(SESSION_SNAPSHOT);
  const [selectedTeamId, setSelectedTeamId] = useState(DELIVERY_TEAM.id);
  const [pendingSwitch, setPendingSwitch] = useState<Team | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const peers = useMemo(() => TEAM_CATALOG.map(teamIdentity), []);
  const selectedTeam =
    TEAM_CATALOG.find((team) => team.id === selectedTeamId) ?? DELIVERY_TEAM;

  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      "[data-team-option] .team-option-main"
    );
    first?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (
        menuRef.current?.contains(event.target as Node) ||
        triggerRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const completeSwitch = (team: Team) => {
    setSnapshot(snapshotFromTeam(team, "刚刚"));
    setPendingSwitch(null);
    onAnnounce(`已载入「${team.name}」当前最新保存的完整版本`);
  };

  const chooseTeam = (team: Team) => {
    if (mode === "new") {
      setSelectedTeamId(team.id);
      closeMenu(true);
      onAnnounce(`新对话将使用「${team.name}」当前已保存版本`);
      return;
    }
    if (team.id === snapshot.teamId) return;
    closeMenu(true);
    if (hasOldWork) {
      setPendingSwitch(team);
      onAnnounce(`当前工作结束后换成「${team.name}」`);
    } else {
      completeSwitch(team);
    }
  };

  const collapsedIdentity =
    mode === "new"
      ? teamIdentity(selectedTeam)
      : pendingSwitch
        ? teamIdentity(pendingSwitch)
        : snapshotIdentity(snapshot);
  const collapsedLabel = identityLabel(collapsedIdentity, peers);

  const switchableTeams =
    mode === "new"
      ? TEAM_CATALOG
      : TEAM_CATALOG.filter((team) => team.id !== snapshot.teamId);

  return (
    <>
      <div className="timeline-stage">
        <div className="timeline-scroller" data-testid="timeline">
          <div className="timeline-top-rule" />
          <div className="message-stack">
            <StaticNote>
              收起按钮读取这段对话当前有效快照：它显示快照里的历史团队身份，
              不被团队目录里的新名称、新成员替换。打开菜单查看完整层级。
            </StaticNote>
            {hasOldWork && mode === "existing" ? (
              <div className="run-indicator" data-testid="run-indicator">
                <Loader aria-hidden="true" className="run-spinner" />
                交付经理正在运行：整理团队选择器评审意见…
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="composer-shell" aria-label="消息输入区示意">
        <div className="composer-context">
          <span>
            <Folder aria-hidden="true" /> agent-moebius
          </span>
          <span>默认工作空间</span>
          <span>main</span>
          <span className="team-menu-anchor">
            <button
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              aria-label={`当前团队：${collapsedLabel}，打开团队选择器`}
              className="team-menu-trigger"
              data-testid="team-menu-trigger"
              onClick={() => setMenuOpen((open) => !open)}
              ref={triggerRef}
              type="button"
            >
              <Diamond aria-hidden="true" />
              <span className="team-menu-trigger-label">{collapsedLabel}</span>
              {pendingSwitch ? (
                <span className="team-menu-pending">待生效</span>
              ) : null}
              <ChevronDown aria-hidden="true" className="team-menu-caret" />
            </button>
          </span>
        </div>
        {pendingSwitch ? (
          <div className="composer-note" data-testid="pending-switch-note">
            当前已启动的运行都结束后换成「{pendingSwitch.name}」
            <button
              className="scene-inline-button"
              onClick={() => completeSwitch(pendingSwitch)}
              type="button"
            >
              模拟旧工作结束
            </button>
          </div>
        ) : null}
        <div className="composer-row">
          <span>继续说点什么，或 @ 一个成员…</span>
          <button aria-label="添加附件" type="button">
            <Plus aria-hidden="true" />
          </button>
          <button aria-label="发送消息" className="send-button" type="button">
            <SendHorizontal aria-hidden="true" />
          </button>
        </div>

        {menuOpen ? (
          <div
            aria-label="团队选择器"
            className="team-menu"
            data-testid="team-menu"
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeMenu(true);
              }
            }}
            ref={menuRef}
            role="dialog"
          >
            {mode === "existing" ? (
              <>
                <TeamOptionCurrent snapshot={snapshot} peers={peers} />
                <div className="team-menu-divider" role="separator">
                  切换到其他团队
                </div>
              </>
            ) : null}
            <div className="team-menu-options">
              {switchableTeams.map((team) => (
                <TeamOptionCatalog
                  expanded={expandedOptionId === team.id}
                  key={team.id}
                  onChoose={() => chooseTeam(team)}
                  onToggleMembers={() =>
                    setExpandedOptionId((current) =>
                      current === team.id ? null : team.id
                    )
                  }
                  peers={peers}
                  selected={mode === "new" && team.id === selectedTeamId}
                  team={team}
                />
              ))}
            </div>
            {mode === "existing" ? (
              <div className="team-menu-footer">
                这段对话沿用当前已载入的团队状态
                <br />
                当前团队的修改不会在这里原地更新
              </div>
            ) : (
              <div className="team-menu-footer">
                发送第一条消息时，以最终选中团队的当前已保存版本建立快照
              </div>
            )}
          </div>
        ) : null}
      </footer>
    </>
  );
}

function TeamOptionCurrent({
  snapshot,
  peers
}: {
  snapshot: TeamSnapshot;
  peers: ReturnType<typeof teamIdentity>[];
}): JSX.Element {
  const identity = snapshotIdentity(snapshot);
  const extra = disambiguationExtra(identity, peers);
  const primary = memberBySlug(snapshot.members, snapshot.primarySlug);
  return (
    <div
      aria-current="true"
      aria-label={`当前对话：${identityLabel(identity, peers)}，不可再次选择`}
      className="team-option team-option-current"
      data-testid="team-option-current"
    >
      <div className="team-option-title">
        <Check aria-hidden="true" className="team-option-check" />
        <span className="team-option-name">当前对话 · {identity.name}</span>
        <SourceBadge source={identity.source} />
        {extra ? <span className="team-option-extra">{extra}</span> : null}
      </div>
      <p className="team-option-purpose">{snapshot.purpose}</p>
      <p className="team-option-meta">
        主 Agent：{primary?.displayName ?? "未记录"} · {snapshot.members.length}{" "}
        名成员
      </p>
      <MemberChipRow members={snapshot.members} primarySlug={snapshot.primarySlug} />
      <p className="team-option-snapshot">快照载入于 {snapshot.loadedAt}</p>
    </div>
  );
}

function TeamOptionCatalog({
  expanded,
  onChoose,
  onToggleMembers,
  peers,
  selected,
  team
}: {
  expanded: boolean;
  onChoose: () => void;
  onToggleMembers: () => void;
  peers: ReturnType<typeof teamIdentity>[];
  selected: boolean;
  team: Team;
}): JSX.Element {
  const identity = teamIdentity(team);
  const extra = disambiguationExtra(identity, peers);
  const primary = memberBySlug(team.members, team.primarySlug);
  return (
    <div
      className={`team-option${selected ? " is-selected" : ""}`}
      data-team-option={team.id}
      data-testid={`team-option-${team.id}`}
    >
      <button
        aria-label={`选择团队：${identityLabel(identity, peers)}`}
        className="team-option-main"
        onClick={onChoose}
        type="button"
      >
        <span className="team-option-title">
          {selected ? (
            <Check aria-hidden="true" className="team-option-check" />
          ) : null}
          <span className="team-option-name">{identity.name}</span>
          <SourceBadge source={identity.source} />
          {extra ? <span className="team-option-extra">{extra}</span> : null}
        </span>
        <span className="team-option-purpose">{team.purpose}</span>
        <span className="team-option-meta">
          主 Agent：{primary?.displayName ?? "未记录"} · {team.members.length}{" "}
          名成员
        </span>
      </button>
      <MemberChipRow
        collapsible
        expanded={expanded}
        members={team.members}
        onToggle={onToggleMembers}
        primarySlug={team.primarySlug}
        teamId={team.id}
      />
    </div>
  );
}

const VISIBLE_MEMBERS = 3;

function MemberChipRow({
  collapsible = false,
  expanded = false,
  members,
  onToggle,
  primarySlug,
  teamId
}: {
  collapsible?: boolean;
  expanded?: boolean;
  members: TeamMember[];
  onToggle?: () => void;
  primarySlug: string;
  teamId?: string;
}): JSX.Element {
  const ordered = [
    ...members.filter((member) => member.slug === primarySlug),
    ...members.filter((member) => member.slug !== primarySlug)
  ];
  const visible =
    collapsible && !expanded ? ordered.slice(0, VISIBLE_MEMBERS) : ordered;
  const hiddenCount = ordered.length - visible.length;
  return (
    <div
      className={`member-chip-row${expanded ? " is-expanded" : ""}`}
      data-testid={teamId ? `member-row-${teamId}` : undefined}
    >
      {visible.map((member) => (
        <span className="member-chip" key={member.slug}>
          <MemberAvatar member={member} />
          {member.displayName}
          {member.slug === primarySlug ? (
            <em className="member-chip-primary">主 Agent</em>
          ) : null}
        </span>
      ))}
      {collapsible && hiddenCount > 0 ? (
        <button
          aria-expanded={expanded}
          aria-label={`展开全部 ${ordered.length} 名成员`}
          className="member-chip member-chip-more"
          data-testid={teamId ? `member-more-${teamId}` : undefined}
          onClick={onToggle}
          type="button"
        >
          ＋{hiddenCount}
        </button>
      ) : null}
      {collapsible && expanded ? (
        <button
          aria-expanded={expanded}
          aria-label="收起成员名单"
          className="member-chip member-chip-more"
          data-testid={teamId ? `member-less-${teamId}` : undefined}
          onClick={onToggle}
          type="button"
        >
          收起
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 场景二：变化提示与「应用」                                          */
/* ------------------------------------------------------------------ */

export function ApplyScene({
  failNext,
  hasOldWork,
  onAnnounce
}: {
  failNext: boolean;
  hasOldWork: boolean;
  onAnnounce: (text: string) => void;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<TeamSnapshot>(SESSION_SNAPSHOT);
  const [applyState, setApplyState] = useState<ApplyState>({ phase: "idle" });
  const [draft, setDraft] = useState("");
  const [failedOnce, setFailedOnce] = useState(false);
  const counterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const changes = detectChanges(snapshot, DELIVERY_TEAM);
  const promptsVisible = applyState.phase === "idle" && hasAnyChange(changes);

  const finishApplied = (team: Team) => {
    setSnapshot(snapshotFromTeam(team, APPLY_LOADED_AT));
    setApplyState({ phase: "applied" });
    onAnnounce("已应用整支团队最新保存的完整版本，后续新工作使用新版");
  };

  const clickApply = () => {
    const next = requestApply(DELIVERY_TEAM, hasOldWork);
    if (next.phase === "applied") {
      finishApplied(DELIVERY_TEAM);
      return;
    }
    setApplyState(next);
    onAnnounce("已冻结点击时的完整团队版本，等待当前工作结束");
  };

  const settleOldWork = () => {
    const outcome = failNext && !failedOnce ? "failure" : "success";
    const next = settlePending(
      applyState,
      outcome,
      "团队版本落盘失败，未应用"
    );
    if (outcome === "failure") {
      setFailedOnce(true);
      setApplyState(next);
      onAnnounce("团队更新未应用：目标版本落盘失败");
      return;
    }
    if (applyState.phase === "pending") {
      finishApplied(applyState.frozen);
    }
  };

  const clickRetry = () => {
    setApplyState(retryApply(applyState));
    onAnnounce("重试应用：仍使用第一次点击时冻结的同一完整版本");
  };

  const clickCancel = () => {
    const { state, released } = cancelApply(applyState);
    setApplyState(state);
    setFailedOnce(false);
    onAnnounce(
      released.length > 0
        ? `已取消应用，${released.length} 条等待消息按当前旧版本继续发射`
        : "已取消应用，继续使用当前已载入的版本"
    );
  };

  const removeQueued = (id: string) => {
    setApplyState((state) => removeWaitingMessage(state, id));
    onAnnounce("已移除这条等待消息");
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (applyState.phase === "pending" || applyState.phase === "failed") {
      counterRef.current += 1;
      const message: QueuedMessage = {
        id: `waiting-${counterRef.current}`,
        text
      };
      setApplyState((state) => enqueueWaitingMessage(state, message));
      onAnnounce("消息已加入「等待团队更新」队列，新快照生效后再解析");
    } else {
      onAnnounce("消息按当前有效快照发射（示意）");
    }
    inputRef.current?.focus();
  };

  const queue =
    applyState.phase === "pending" || applyState.phase === "failed"
      ? applyState.queue
      : [];

  return (
    <>
      <div className="timeline-stage">
        <div className="timeline-scroller" data-testid="timeline">
          <div className="timeline-top-rule" />
          <div className="message-stack">
            <StaticNote>
              团队页保存修改后，这段旧对话仍使用载入时的快照；差异只在输入框
              上方按类别提示。任一「应用」都载入整支团队最新完整版本。
            </StaticNote>
            {hasOldWork ? (
              <div className="run-indicator" data-testid="run-indicator">
                <Loader aria-hidden="true" className="run-spinner" />
                交付经理正在运行：汇总原型验证结果…
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="composer-shell composer-shell-tall" aria-label="消息输入区示意">
        {promptsVisible ? (
          <div className="change-prompts" data-testid="change-prompts">
            {changes.agentDefinition > 0 ? (
              <ChangePrompt
                label={`Agent 定义已更新 · ${changes.agentDefinition} 名成员`}
                onApply={clickApply}
              />
            ) : null}
            {changes.runtimeConfig > 0 ? (
              <ChangePrompt
                label={`运行配置已更新 · ${changes.runtimeConfig} 名成员`}
                onApply={clickApply}
              />
            ) : null}
            {changes.teamInfo ? (
              <ChangePrompt label="团队信息已更新" onApply={clickApply} />
            ) : null}
            <p className="change-prompt-caption">
              本对话仍使用当前已载入的版本。任一「应用」都会载入整支团队最新保存的完整版本。
            </p>
          </div>
        ) : null}

        {applyState.phase === "pending" ? (
          <div className="apply-status" data-testid="apply-pending">
            <Info aria-hidden="true" />
            <span>当前工作结束后应用团队更新</span>
            <button
              className="scene-inline-button"
              data-testid="settle-old-work"
              onClick={settleOldWork}
              type="button"
            >
              模拟旧工作结束
            </button>
          </div>
        ) : null}

        {applyState.phase === "failed" ? (
          <div className="apply-status apply-status-failed" data-testid="apply-failed">
            <CircleAlert aria-hidden="true" />
            <span>团队更新未应用：{applyState.reason}</span>
            <button
              className="scene-inline-button"
              data-testid="retry-apply"
              onClick={clickRetry}
              type="button"
            >
              重试应用
            </button>
            <button
              className="scene-inline-button"
              data-testid="cancel-apply"
              onClick={clickCancel}
              type="button"
            >
              取消应用并继续使用当前版本
            </button>
          </div>
        ) : null}

        {applyState.phase === "applied" ? (
          <div className="apply-status" data-testid="apply-done">
            <Check aria-hidden="true" />
            <span>
              已应用整支团队最新保存的完整版本（快照载入于 {snapshot.loadedAt}
              ）；历史步骤的重试与重新运行仍用各自旧快照。
            </span>
            <button
              className="scene-inline-button"
              onClick={() => {
                setSnapshot(SESSION_SNAPSHOT);
                setApplyState({ phase: "idle" });
                setFailedOnce(false);
                onAnnounce("场景已重置");
              }}
              type="button"
            >
              重置场景
            </button>
          </div>
        ) : null}

        {queue.length > 0 ? (
          <div className="waiting-queue" data-testid="waiting-queue">
            <p className="waiting-queue-title">
              等待团队更新 · {queue.length} 条（可编辑、可移除，不按旧版发射）
            </p>
            {queue.map((item) => (
              <div className="waiting-queue-item" key={item.id}>
                <span>{item.text}</span>
                <button
                  aria-label={`移除等待消息：${item.text}`}
                  onClick={() => removeQueued(item.id)}
                  type="button"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="composer-row composer-row-input">
          <input
            aria-label="消息草稿"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") sendDraft();
            }}
            placeholder={
              applyState.phase === "pending" || applyState.phase === "failed"
                ? "发送后将等待团队更新生效…"
                : "继续说点什么，或 @ 一个成员…"
            }
            ref={inputRef}
            value={draft}
          />
          <button
            aria-label="发送消息"
            className="send-button"
            onClick={sendDraft}
            type="button"
          >
            <SendHorizontal aria-hidden="true" />
          </button>
        </div>
      </footer>
    </>
  );
}

function ChangePrompt({
  label,
  onApply
}: {
  label: string;
  onApply: () => void;
}): JSX.Element {
  return (
    <div className="change-prompt">
      <Info aria-hidden="true" />
      <span>{label}</span>
      <button
        className="apply-button"
        data-testid={`apply-${label}`}
        onClick={onApply}
        type="button"
      >
        应用
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 场景三：头像信息卡                                                  */
/* ------------------------------------------------------------------ */

export function AvatarCardScene({
  onAnnounce
}: {
  onAnnounce: (text: string) => void;
}): JSX.Element {
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [viewerRecordId, setViewerRecordId] = useState<string | null>(null);
  const avatarRefs = useRef(new Map<string, HTMLButtonElement>());
  const cardElementRef = useRef<HTMLDivElement | null>(null);

  const peers = useMemo(() => TEAM_CATALOG.map(teamIdentity), []);
  const teamLabel = identityLabel(snapshotIdentity(SESSION_SNAPSHOT), peers);

  useEffect(() => {
    if (!openRecordId) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !viewerRecordId) {
        closeCard(openRecordId);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        cardElementRef.current?.contains(target) ||
        avatarRefs.current.get(openRecordId)?.contains(target)
      ) {
        return;
      }
      setOpenRecordId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRecordId, viewerRecordId]);

  const closeCard = (recordId: string) => {
    setOpenRecordId(null);
    avatarRefs.current.get(recordId)?.focus();
  };

  const viewerRecord = AGENT_RECORDS.find(
    (record) => record.id === viewerRecordId
  );

  return (
    <>
      <div className="timeline-stage">
        <div className="timeline-scroller" data-testid="timeline">
          <div className="timeline-top-rule" />
          <div className="message-stack">
            <StaticNote>
              每条 Agent 记录的头像都可以打开「当时」信息卡：它只回答这条记录
              当时绑定或尝试了什么配置，不显示当前团队的新值。
            </StaticNote>
            {AGENT_RECORDS.map((record) => (
              <AgentRecordRow
                isOpen={openRecordId === record.id}
                key={record.id}
                onAnnounce={onAnnounce}
                onCloseCard={() => closeCard(record.id)}
                onOpenCard={() =>
                  setOpenRecordId((current) =>
                    current === record.id ? null : record.id
                  )
                }
                onViewMarkdown={() => setViewerRecordId(record.id)}
                record={record}
                registerAvatar={(element) => {
                  if (element) avatarRefs.current.set(record.id, element);
                  else avatarRefs.current.delete(record.id);
                }}
                registerCard={(element) => {
                  cardElementRef.current = element;
                }}
                teamLabel={teamLabel}
              />
            ))}
          </div>
        </div>

        {viewerRecord ? (
          <AgentMarkdownViewer
            onClose={() => {
              setViewerRecordId(null);
              avatarRefs.current.get(viewerRecord.id)?.focus();
            }}
            record={viewerRecord}
          />
        ) : null}
      </div>

      <footer className="composer-shell" aria-label="消息输入区示意">
        <div className="composer-context">
          <span>
            <Folder aria-hidden="true" /> agent-moebius
          </span>
          <span>默认工作空间</span>
          <span>main</span>
          <span>
            <Users aria-hidden="true" /> 开发团队
          </span>
        </div>
        <div className="composer-row">
          <span>继续说点什么，或 @ 一个成员…</span>
          <button aria-label="添加附件" type="button">
            <Plus aria-hidden="true" />
          </button>
          <button aria-label="发送消息" className="send-button" type="button">
            <SendHorizontal aria-hidden="true" />
          </button>
        </div>
      </footer>
    </>
  );
}

function AgentRecordRow({
  isOpen,
  onAnnounce,
  onCloseCard,
  onOpenCard,
  onViewMarkdown,
  record,
  registerAvatar,
  registerCard,
  teamLabel
}: {
  isOpen: boolean;
  onAnnounce: (text: string) => void;
  onCloseCard: () => void;
  onOpenCard: () => void;
  onViewMarkdown: () => void;
  record: AgentRecord;
  registerAvatar: (element: HTMLButtonElement | null) => void;
  registerCard: (element: HTMLDivElement | null) => void;
  teamLabel: string;
}): JSX.Element {
  const member = memberBySlug(SESSION_SNAPSHOT.members, record.memberSlug);
  const articleRef = useRef<HTMLElement>(null);
  const cardInnerRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const [shiftX, setShiftX] = useState(0);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const article = articleRef.current;
    const card = cardInnerRef.current;
    const stage = article?.closest(".timeline-stage");
    if (!article || !card || !stage) return;
    const articleRect = article.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const fitsBelow =
      articleRect.bottom + 6 + cardRect.height <= stageRect.bottom - 8;
    const fitsAbove =
      articleRect.top - 6 - cardRect.height >= stageRect.top + 8;
    setPlacement(!fitsBelow && fitsAbove ? "above" : "below");
    const overflowRight =
      articleRect.left - 6 + cardRect.width - (stageRect.right - 8);
    setShiftX(overflowRight > 0 ? -overflowRight : 0);
  }, [isOpen]);

  if (!member) return <></>;
  return (
    <article
      className="timeline-message timeline-message-anchor"
      data-testid={`agent-record-${record.id}`}
      ref={articleRef}
    >
      <div className="message-who">
        <button
          aria-expanded={isOpen}
          aria-label={`查看${member.displayName}当时的配置`}
          className="actor-avatar actor-avatar-button"
          data-testid={`avatar-${record.id}`}
          data-tone={member.tone}
          onClick={() => {
            onOpenCard();
            onAnnounce(
              isOpen
                ? "已关闭当时信息卡"
                : `已打开${member.displayName}的当时信息卡`
            );
          }}
          ref={registerAvatar}
          type="button"
        >
          {glyphOf(member)}
        </button>
        <strong>{member.displayName}</strong>
        <time>{record.time}</time>
        {record.outcome === "failed-before-start" ? (
          <span className="record-outcome record-outcome-failed">
            这一步没跑起来
          </span>
        ) : null}
      </div>
      <div className="message-body">{record.summary}</div>
      {isOpen ? (
        <AgentInfoCard
          cardRef={(element) => {
            cardInnerRef.current = element;
            registerCard(element);
          }}
          onClose={onCloseCard}
          onViewMarkdown={onViewMarkdown}
          placement={placement}
          record={record}
          shiftX={shiftX}
          teamLabel={teamLabel}
        />
      ) : null}
    </article>
  );
}

function AgentInfoCard({
  cardRef,
  onClose,
  onViewMarkdown,
  placement,
  record,
  shiftX,
  teamLabel
}: {
  cardRef: React.Ref<HTMLDivElement>;
  onClose: () => void;
  onViewMarkdown: () => void;
  placement: "below" | "above";
  record: AgentRecord;
  shiftX: number;
  teamLabel: string;
}): JSX.Element {
  const member = memberBySlug(SESSION_SNAPSHOT.members, record.memberSlug);
  if (!member) return <></>;
  return (
    <div
      aria-label={`${member.displayName}当时的配置`}
      className="agent-info-card"
      data-placement={placement}
      data-testid="agent-info-card"
      ref={cardRef}
      role="dialog"
      style={{ left: `calc(-6px + ${shiftX}px)` }}
    >
      <div className="agent-info-card-head">
        <MemberAvatar member={member} size="heading" />
        <div>
          <p className="agent-info-name">{member.displayName}</p>
          <p className="agent-info-identity">
            @{member.slug} · {teamLabel}
          </p>
        </div>
        <button aria-label="关闭信息卡" onClick={onClose} type="button">
          <X aria-hidden="true" />
        </button>
      </div>
      <p className="agent-info-provenance" data-testid="config-provenance">
        {provenanceLabel(record.provenance)}
      </p>
      <dl className="agent-info-grid">
        <div>
          <dt>CLI</dt>
          <dd>{record.cli}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{record.model ?? "此项未记录"}</dd>
        </div>
        <div>
          <dt>思考程度</dt>
          <dd>{record.effort ?? "此项未记录"}</dd>
        </div>
      </dl>
      <p className="agent-info-loaded">
        团队版本载入于 {SESSION_SNAPSHOT.loadedAt}
      </p>
      <button
        aria-label={`查看${member.displayName}当时的完整 AGENT.md`}
        className="agent-info-markdown-button"
        data-testid="view-agent-markdown"
        onClick={onViewMarkdown}
        type="button"
      >
        <FileText aria-hidden="true" /> 查看 AGENT.md
      </button>
    </div>
  );
}

function AgentMarkdownViewer({
  onClose,
  record
}: {
  onClose: () => void;
  record: AgentRecord;
}): JSX.Element {
  const member = memberBySlug(SESSION_SNAPSHOT.members, record.memberSlug);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!member) return <></>;
  return (
    <div className="agent-md-backdrop" data-testid="agent-md-viewer">
      <div
        aria-label={`${member.displayName}当时的 AGENT.md（只读）`}
        aria-modal="true"
        className="agent-md-dialog"
        role="dialog"
      >
        <div className="agent-md-head">
          <p>
            {member.displayName} · 当时的 AGENT.md
            <span>只读 · 冻结于快照载入时，不是当前磁盘文件</span>
          </p>
          <button
            aria-label="关闭 AGENT.md 查看器"
            data-testid="close-agent-markdown"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <pre className="agent-md-body">{member.agentMarkdown}</pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 场景四：团队页保存反馈                                              */
/* ------------------------------------------------------------------ */

const SAVE_FEEDBACK_TEXT =
  "已保存，无需重启。新建对话选择这支团队时会使用修改；正在使用这支团队的对话会显示变化提示，点击任一「应用」会载入整支团队最新保存的完整版本。";

export function TeamSaveScene({
  partialFailure,
  onAnnounce
}: {
  partialFailure: boolean;
  onAnnounce: (text: string) => void;
}): JSX.Element {
  const editable = useMemo(
    () => DELIVERY_TEAM.members.slice(0, 4),
    []
  );
  const [view, setView] = useState<"detail" | "home">("detail");
  const [unsaved, setUnsaved] = useState<Set<string>>(
    () => new Set(["dev", "qa"])
  );
  const [feedback, setFeedback] = useState<ReactNode>(null);
  const [homeFeedback, setHomeFeedback] = useState<string | null>(null);
  const [qaRetried, setQaRetried] = useState(false);

  const outcomesFor = (slugs: string[]): SaveItemOutcome[] =>
    slugs.map((slug) => {
      const member = memberBySlug(editable, slug);
      const fail = partialFailure && slug === "qa" && !qaRetried;
      return {
        slug,
        displayName: member?.displayName ?? slug,
        ok: !fail,
        error: fail ? "写入被拒绝（fixture 模拟）" : undefined
      };
    });

  const renderOutcomes = (outcomes: SaveItemOutcome[]): ReactNode => {
    const summary = summarizeSave(outcomes);
    if (summary.savedAll) {
      return (
        <p className="save-feedback-line" data-testid="save-feedback-success">
          <Check aria-hidden="true" /> {SAVE_FEEDBACK_TEXT}
        </p>
      );
    }
    return (
      <>
        {summary.saved.map((item) => (
          <p className="save-feedback-line" key={item.slug}>
            <Check aria-hidden="true" /> {item.displayName}
            ：已保存，无需重启。
          </p>
        ))}
        {summary.failed.map((item) => (
          <p
            className="save-feedback-line save-feedback-failed"
            data-testid="save-feedback-item-failed"
            key={item.slug}
          >
            <CircleAlert aria-hidden="true" /> {item.displayName}
            ：未保存，仍使用上一次保存的版本。（{item.error}）
            <button
              className="scene-inline-button"
              data-testid="retry-save-item"
              onClick={() => {
                setQaRetried(true);
                setUnsaved((current) => {
                  const next = new Set(current);
                  next.delete(item.slug);
                  return next;
                });
                setFeedback(
                  <p
                    className="save-feedback-line"
                    data-testid="save-feedback-success"
                  >
                    <Check aria-hidden="true" /> {item.displayName}
                    ：已保存，无需重启。
                  </p>
                );
                onAnnounce(`${item.displayName} 已保存`);
              }}
              type="button"
            >
              重试
            </button>
          </p>
        ))}
      </>
    );
  };

  const saveOne = (slug: string) => {
    const outcomes = outcomesFor([slug]);
    const summary = summarizeSave(outcomes);
    setFeedback(renderOutcomes(outcomes));
    if (summary.savedAll) {
      setUnsaved((current) => {
        const next = new Set(current);
        next.delete(slug);
        return next;
      });
      onAnnounce("已保存当前成员，无需重启");
    } else {
      onAnnounce("保存失败：仍使用上一次保存的版本，草稿已保留");
    }
  };

  const saveAllAndLeave = () => {
    const outcomes = outcomesFor([...unsaved]);
    const summary = summarizeSave(outcomes);
    if (shouldNavigateAfterSaveAll(summary)) {
      setHomeFeedback(
        `已保存「${DELIVERY_TEAM.name}」的 ${summary.saved.length} 个项目，无需重启。新建对话选择这支团队时会使用修改；正在使用这支团队的对话会显示变化提示，点击任一「应用」会载入整支团队最新保存的完整版本。`
      );
      setUnsaved(new Set());
      setFeedback(null);
      setView("home");
      onAnnounce("已全部保存并返回团队首页");
    } else {
      setFeedback(renderOutcomes(outcomes));
      setUnsaved(new Set(summary.failed.map((item) => item.slug)));
      onAnnounce("部分项目未保存，仍停留在团队详情");
    }
  };

  if (view === "home") {
    return (
      <div className="teams-page" data-testid="teams-home">
        {homeFeedback ? (
          <div className="save-feedback save-feedback-home" data-testid="home-save-feedback">
            <p className="save-feedback-line">
              <Check aria-hidden="true" /> {homeFeedback}
            </p>
          </div>
        ) : null}
        <header className="teams-page-head">
          <h2>Agent 团队</h2>
          <button
            className="scene-inline-button"
            onClick={() => setView("detail")}
            type="button"
          >
            返回团队详情
          </button>
        </header>
        {TEAM_CATALOG.map((team) => (
          <div className="teams-home-row" key={team.id}>
            <span className="teams-home-name">{team.name}</span>
            <SourceBadge source={team.source} />
            <span className="teams-home-meta">
              {team.purpose} · {team.members.length} 名成员
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="teams-page" data-testid="teams-detail">
      <header className="teams-page-head">
        <h2>{DELIVERY_TEAM.name}</h2>
        <SourceBadge source={DELIVERY_TEAM.source} />
      </header>
      <p className="teams-page-purpose">{DELIVERY_TEAM.purpose}</p>

      <div className="teams-member-list">
        {editable.map((member) => (
          <div className="teams-member-row" key={member.slug}>
            <MemberAvatar member={member} />
            <span className="teams-member-name">{member.displayName}</span>
            <span className="teams-member-slug">@{member.slug}</span>
            <span className="teams-member-config">
              {member.cli} · {member.model} · {member.effort}
            </span>
            {unsaved.has(member.slug) ? (
              <span
                className="teams-member-unsaved"
                data-testid={`unsaved-${member.slug}`}
              >
                未保存
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="teams-actions">
        <button
          className="scene-button"
          data-testid="save-current-member"
          onClick={() => saveOne("dev")}
          type="button"
        >
          保存当前成员（开发工程师）
        </button>
        <button
          className="scene-button"
          data-testid="save-all-and-leave"
          disabled={unsaved.size === 0}
          onClick={saveAllAndLeave}
          type="button"
        >
          保存全部并离开
        </button>
      </div>

      {feedback ? (
        <div aria-live="polite" className="save-feedback" data-testid="save-feedback">
          {feedback}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 共享：场景说明                                                      */
/* ------------------------------------------------------------------ */

function StaticNote({ children }: { children: ReactNode }): JSX.Element {
  return <p className="scene-note">{children}</p>;
}
