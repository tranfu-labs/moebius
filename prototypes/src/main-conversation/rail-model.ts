export type EventKind = "user" | "agent";

export interface RailActor {
  id: string;
  name: string;
  shortName: string;
  kind: EventKind;
  tone: "user" | "indigo" | "violet" | "amber" | "cyan";
}

export interface RailEvent {
  id: string;
  actorId: string;
  kind: EventKind;
  body: string;
  triggerUserEventId?: string;
  time: string;
}

export interface ConversationFixture {
  id: string;
  title: string;
  events: RailEvent[];
  initialFocusId: string;
}

export interface EventRailRow {
  type: "event";
  event: RailEvent;
  eventIndex: number;
}

export interface OmissionRailRow {
  type: "omission";
  fromIndex: number;
  toIndex: number;
  count: number;
}

export type RailRow = EventRailRow | OmissionRailRow;

export interface EventPreview {
  title: string | null;
  actorName: string;
  body: string;
}

export interface ActivationResult {
  focusedEventId: string;
  activated: boolean;
  feedback: string;
}

export const RAIL_ROW_HEIGHT = 20;
export const MIN_RAIL_CAPACITY = 7;

export const ACTORS: RailActor[] = [
  {
    id: "user",
    name: "你",
    shortName: "你",
    kind: "user",
    tone: "user"
  },
  {
    id: "product-lead",
    name: "产品交付负责人",
    shortName: "产",
    kind: "agent",
    tone: "indigo"
  },
  {
    id: "product-reviewer",
    name: "产品评审",
    shortName: "评",
    kind: "agent",
    tone: "violet"
  },
  {
    id: "ui-prototyper",
    name: "界面原型师",
    shortName: "原",
    kind: "agent",
    tone: "amber"
  },
  {
    id: "implementation-lead",
    name: "实施负责人",
    shortName: "实",
    kind: "agent",
    tone: "cyan"
  }
];

const events: RailEvent[] = [
  userEvent("event-01", "我们能在会话列表左侧显示多泳道进度条吗？", "10:02"),
  agentEvent(
    "event-02",
    "product-lead",
    "event-01",
    "可以显示，但更准确的名字是紧凑接力轨迹；真实协作没有固定终点。",
    "10:03"
  ),
  userEvent("event-03", "所以重点是不显示文字，只有紧凑的多线图形，对吗？", "10:05"),
  agentEvent(
    "event-04",
    "product-lead",
    "event-03",
    "对，默认只保留细线与节点，完整含义通过可访问名称和预览提供。",
    "10:06"
  ),
  userEvent("event-05", "鼠标放上去的悬浮呢？还要考虑容器宽度响应。", "10:08"),
  agentEvent(
    "event-06",
    "product-lead",
    "event-05",
    "悬浮只预览当前节点，图形按容器实际宽度压缩，不按窗口媒体查询猜测。",
    "10:09"
  ),
  userEvent("event-07", "Hover 只显示那个点对应回复的简介，不要展开整条轨迹。", "10:11"),
  agentEvent(
    "event-08",
    "product-lead",
    "event-07",
    "收到，卡片使用原回复开头，不生成摘要；点击节点定位到原回复。",
    "10:12"
  ),
  userEvent("event-09", "成员名要用可读名称，并采用原回复开头加点击定位。", "10:14"),
  agentEvent(
    "event-10",
    "product-lead",
    "event-09",
    "预览显示产品交付负责人、界面原型师这类可读名称，不暴露内部 slug。",
    "10:15"
  ),
  userEvent("event-11", "但用户消息怎么算？Codex 的节点通常是一条用户消息。", "10:17"),
  agentEvent(
    "event-12",
    "product-lead",
    "event-11",
    "用户消息适合作为回忆锚点，但 Moebius 还必须呈现一条消息触发的多人接力。",
    "10:18"
  ),
  userEvent("event-13", "我们会 A 到 B 到 C，再回到 B 和 C，不是简单线性推进。", "10:20"),
  agentEvent(
    "event-14",
    "product-lead",
    "event-13",
    "轨迹按真实时间连续绘制，不识别固定阶段，也不人为区分采访和自动执行。",
    "10:21"
  ),
  agentEvent(
    "event-15",
    "product-reviewer",
    "event-13",
    "用户消息与 Agent 回复都应形成可见事件，才能避免把协作密度误当成进度。",
    "10:22"
  ),
  agentEvent(
    "event-16",
    "ui-prototyper",
    "event-13",
    "收起态可以用目录短横线，展开态再显示用户菱形、成员圆点和折返连线。",
    "10:23"
  ),
  agentEvent(
    "event-17",
    "product-reviewer",
    "event-13",
    "所有已画出的真实节点都应支持预览与定位，禁用中间节点反而违背直觉。",
    "10:24"
  ),
  agentEvent(
    "event-18",
    "ui-prototyper",
    "event-13",
    "展开前后应保留完全相同的纵向位置，只替换横向表达，避免阅读焦点跳动。",
    "10:25"
  ),
  userEvent("event-19", "节点多时应该按固定行高纵向排列，超过高度再围绕当前位置折叠。", "10:28"),
  agentEvent(
    "event-20",
    "product-lead",
    "event-19",
    "采用跟随阅读焦点的滑动窗口：焦点始终可见，首尾尽量保留，远端区间才省略。",
    "10:29"
  ),
  agentEvent(
    "event-21",
    "ui-prototyper",
    "event-19",
    "轨迹内滚轮与方向键只移动目录焦点，不抢走主时间线位置，激活后才定位正文。",
    "10:30"
  ),
  userEvent("event-22", "头像有身份色；收起时用横线，展开后不要继续用横线。", "10:33"),
  agentEvent(
    "event-23",
    "product-lead",
    "event-22",
    "收起态继承身份色的短横线，当前焦点更长；身份色不承担运行或异常状态。",
    "10:34"
  ),
  agentEvent(
    "event-24",
    "ui-prototyper",
    "event-22",
    "展开态使用地铁图语法：用户是菱形，Agent 是圆点，中性连接线显示真实往返。",
    "10:35"
  ),
  agentEvent(
    "event-25",
    "product-reviewer",
    "event-22",
    "展开态不常驻成员文字或头像表头，准确身份继续由 Hover Card 提供。",
    "10:36"
  ),
  agentEvent(
    "event-26",
    "ui-prototyper",
    "event-22",
    "交互骨架借鉴 Preview Rail 的固定行高、受控当前项与浮动预览，但移除缩放和弹跳。",
    "10:37"
  ),
  userEvent("event-27", "默认常驻、按上次阅读位置聚焦，多泳道覆盖展开，这些都确认。", "10:40"),
  agentEvent(
    "event-28",
    "product-lead",
    "event-27",
    "已确认：新消息不强制把旧会话阅读位置推到底部，缺失关联时也不按时间猜测。",
    "10:41"
  ),
  agentEvent(
    "event-29",
    "implementation-lead",
    "event-27",
    "实施时会把窗口算法、真实触发关系、缓存失败恢复和定位状态机分别验证。",
    "10:43"
  ),
  userEvent("event-30", "不对，这不是会话列表左侧，而是主会话正文固定的左边目录。", "10:47"),
  agentEvent(
    "event-31",
    "product-lead",
    "event-30",
    "纠偏：会话列表保持普通导航密度，当前主会话只保留一条固定目录轨。",
    "10:48"
  ),
  agentEvent(
    "event-32",
    "product-reviewer",
    "event-30",
    "容量应取自主时间线视口，不能沿用侧栏原型的九行上限和侧栏宽度参数。",
    "10:49"
  ),
  agentEvent(
    "event-33",
    "ui-prototyper",
    "event-30",
    "新原型将目录固定在正文列左侧留白，展开覆盖正文左缘，不改变正文宽度。",
    "10:50"
  ),
  agentEvent(
    "event-34",
    "product-lead",
    "event-30",
    "主会话落点已经确认，可以进入新的高保真原型验证。",
    "10:51"
  )
];

export const CONVERSATION: ConversationFixture = {
  id: "main-conversation-rail",
  title: "主会话目录轨应该放在哪里",
  events,
  initialFocusId: "event-34"
};

export function deriveRailCapacity(
  viewportHeight: number,
  rowHeight = RAIL_ROW_HEIGHT
): number {
  const measured = Math.floor(Math.max(0, viewportHeight - 20) / rowHeight);
  return Math.max(MIN_RAIL_CAPACITY, measured);
}

export function computeRailRows(
  sourceEvents: RailEvent[],
  focusId: string,
  capacity: number
): RailRow[] {
  if (sourceEvents.length === 0) return [];

  const safeCapacity = Math.max(MIN_RAIL_CAPACITY, capacity);
  if (sourceEvents.length <= safeCapacity) {
    return sourceEvents.map((event, eventIndex) => ({
      type: "event",
      event,
      eventIndex
    }));
  }

  const focusIndex = Math.max(
    0,
    sourceEvents.findIndex((event) => event.id === focusId)
  );
  const edgeWindow = safeCapacity - 2;

  if (focusIndex < edgeWindow) {
    return rowsFromIndexes(sourceEvents, [
      ...range(0, edgeWindow - 1),
      sourceEvents.length - 1
    ]);
  }

  if (focusIndex >= sourceEvents.length - edgeWindow) {
    return rowsFromIndexes(sourceEvents, [
      0,
      ...range(sourceEvents.length - edgeWindow, sourceEvents.length - 1)
    ]);
  }

  const middleWindow = safeCapacity - 4;
  const before = Math.floor((middleWindow - 1) / 2);
  const start = focusIndex - before;
  return rowsFromIndexes(sourceEvents, [
    0,
    ...range(start, start + middleWindow - 1),
    sourceEvents.length - 1
  ]);
}

export function previewForEvent(
  conversation: ConversationFixture,
  event: RailEvent
): EventPreview {
  const actor = actorById(event.actorId);
  if (event.kind === "user") {
    return {
      title: "你",
      actorName: "你",
      body: event.body
    };
  }

  return {
    title: null,
    actorName: actor.name,
    body: event.body
  };
}

export function createGitGraphCurvePath(
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number
): string {
  const verticalDistance = currentY - previousY;
  return [
    `M ${previousX} ${previousY}`,
    `C ${previousX} ${previousY + verticalDistance * (20 / 31)}`,
    `${currentX} ${previousY + verticalDistance * (11 / 31)}`,
    `${currentX} ${currentY}`
  ].join(" ");
}

export function actorById(actorId: string): RailActor {
  return ACTORS.find((actor) => actor.id === actorId) ?? ACTORS[0];
}

export function adjacentEventId(
  sourceEvents: RailEvent[],
  currentId: string,
  direction: -1 | 1
): string {
  const currentIndex = Math.max(
    0,
    sourceEvents.findIndex((event) => event.id === currentId)
  );
  return sourceEvents[
    clamp(currentIndex + direction, 0, sourceEvents.length - 1)
  ]?.id ?? currentId;
}

export function activateEvent(
  currentFocusId: string,
  eventId: string,
  shouldFail: boolean
): ActivationResult {
  if (shouldFail) {
    return {
      focusedEventId: currentFocusId,
      activated: false,
      feedback: "无法定位到原消息，已保持当前阅读位置"
    };
  }

  return {
    focusedEventId: eventId,
    activated: true,
    feedback: "已定位并突出原消息"
  };
}

export function overlayWidthForContainer(containerWidth: number): number {
  return clamp(Math.round(156 + (containerWidth - 560) * 0.18), 148, 224);
}

function rowsFromIndexes(
  sourceEvents: RailEvent[],
  indexes: number[]
): RailRow[] {
  const uniqueIndexes = [...new Set(indexes)]
    .filter((index) => index >= 0 && index < sourceEvents.length)
    .sort((left, right) => left - right);
  const rows: RailRow[] = [];

  uniqueIndexes.forEach((eventIndex, position) => {
    const previousIndex = uniqueIndexes[position - 1];
    if (previousIndex !== undefined && eventIndex - previousIndex > 1) {
      const fromIndex = previousIndex + 1;
      const toIndex = eventIndex - 1;
      rows.push({
        type: "omission",
        fromIndex,
        toIndex,
        count: toIndex - fromIndex + 1
      });
    }
    rows.push({
      type: "event",
      event: sourceEvents[eventIndex],
      eventIndex
    });
  });

  return rows;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => {
    return start + index;
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function userEvent(id: string, body: string, time: string): RailEvent {
  return {
    id,
    actorId: "user",
    kind: "user",
    body,
    time
  };
}

function agentEvent(
  id: string,
  actorId: string,
  triggerUserEventId: string,
  body: string,
  time: string
): RailEvent {
  return {
    id,
    actorId,
    kind: "agent",
    triggerUserEventId,
    body,
    time
  };
}
