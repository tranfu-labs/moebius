import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { AgentFormCard, type AgentFormCardProps } from "@/console/agent-form-card";
import {
  createAgentFormDraft,
  isRenderableAgentForm,
  type AgentFormDraft,
  type AgentFormSpec,
} from "@/console/agent-form-model";

const wrapUpForm: AgentFormSpec = {
  id: "wrap-up",
  memberName: "开发",
  memberSlug: "dev",
  engine: { cli: "codex" },
  questions: [
    {
      id: "landing",
      kind: "single",
      title: "这段改动怎么收尾",
      options: [
        { id: "merge", title: "合并进主线", description: "我已经自测过，出问题我来改" },
        { id: "keep", title: "先留在分支上", description: "你想再看两天再决定" },
      ],
    },
    {
      id: "cleanup",
      kind: "multiple",
      title: "顺手清理哪些东西",
      options: [
        { id: "workspace", title: "删掉这次用的独立工作空间", description: "里面只有这次的改动，删了不影响别的" },
        { id: "logs", title: "清掉本地跑出来的日志", description: "占了 200 多 MB，重新跑一次就会有" },
      ],
    },
    {
      id: "notify",
      kind: "single",
      title: "要不要通知别人",
      options: [
        { id: "silent", title: "先不通知" },
        { id: "team", title: "在群里说一声" },
      ],
    },
    { id: "note", kind: "text", title: "还有什么要我知道的" },
  ],
};

const singleQuestionForm: AgentFormSpec = {
  id: "single-question",
  memberName: "测试",
  memberSlug: "qa",
  engine: { cli: "claude" },
  questions: [
    {
      id: "rerun",
      kind: "single",
      title: "刚才那条用例失败了，接下来怎么办",
      options: [
        { id: "retry", title: "再跑一次", description: "上次是超时，很可能是机器一时慢了" },
        { id: "stop", title: "先停下来", description: "我把失败的详情整理给你" },
        { id: "inspect", title: "先看详情", description: "打开失败步骤和原始输出再决定" },
        { id: "replace", title: "换一条用例", description: "保留这次失败记录，改测另一条路径" },
      ],
    },
  ],
};

const freeTextForm: AgentFormSpec = {
  id: "free-text",
  memberName: "产品",
  memberSlug: "product-manager",
  engine: { cli: "kimi" },
  questions: [{ id: "audience", kind: "text", title: "这版主要给谁看，写一句就行" }],
};

/** Deliberately over the product limits: five questions is not a renderable form. */
const oversizedForm: AgentFormSpec = {
  id: "oversized",
  memberName: "开发",
  memberSlug: "dev",
  questions: [1, 2, 3, 4, 5].map((index) => ({
    id: `q${index}`,
    kind: "text" as const,
    title: `第 ${index} 个问题`,
  })),
};

function answered(spec: AgentFormSpec, partial: Partial<AgentFormDraft>): AgentFormDraft {
  return { ...createAgentFormDraft(spec), ...partial };
}

/**
 * Stories drive the real component the way the renderer will: the host owns the draft.
 * 发送的结果不画在画布上——它是一条普通用户消息，真实样子在
 * `Page/Console/OperatorConsole` 的「Agent 表单」两个 story 里；这里只把组装好的文本
 * 交给 Storybook 的 Actions 面板。
 */
function LiveForm({
  spec,
  initialDraft,
  onSubmit,
  width = 560,
  height,
}: {
  spec: AgentFormSpec;
  initialDraft?: AgentFormDraft;
  onSubmit?: AgentFormCardProps["onSubmit"];
  width?: number;
  height?: number;
}): JSX.Element {
  const [draft, setDraft] = useState<AgentFormDraft>(initialDraft ?? createAgentFormDraft(spec));

  return (
    <div style={height === undefined ? { width } : { width, height }}>
      <AgentFormCard spec={spec} draft={draft} onDraftChange={setDraft} onSubmit={onSubmit} />
    </div>
  );
}

const meta = {
  title: "Component/Console/AgentFormCard",
  component: AgentFormCard,
  args: { spec: wrapUpForm },
  argTypes: { onSubmit: { action: "submit" } },
  parameters: { layout: "centered" },
} satisfies Meta<typeof AgentFormCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultiQuestion: Story = {
  name: "多题 · 第一题",
  render: (args) => <LiveForm spec={wrapUpForm} onSubmit={args.onSubmit} />,
};

export const MiddleQuestion: Story = {
  name: "多题 · 中间某一题",
  render: (args) => (
    <LiveForm
      spec={wrapUpForm}
      onSubmit={args.onSubmit}
      initialDraft={answered(wrapUpForm, {
        activeIndex: 1,
        answers: {
          landing: { selectedOptionIds: ["merge"], ownText: "" },
          cleanup: { selectedOptionIds: ["workspace"], ownText: "" },
        },
      })}
    />
  ),
};

export const LastQuestion: Story = {
  name: "多题 · 最后一题",
  render: (args) => (
    <LiveForm
      spec={wrapUpForm}
      onSubmit={args.onSubmit}
      initialDraft={answered(wrapUpForm, {
        activeIndex: 3,
        answers: {
          landing: { selectedOptionIds: ["merge"], ownText: "" },
          cleanup: { selectedOptionIds: ["workspace"], ownText: "还有 .env.local" },
          notify: { selectedOptionIds: [], ownText: "" },
        },
      })}
    />
  ),
};

export const NothingAnswered: Story = {
  name: "一题都没答 · 发送禁用",
  render: (args) => <LiveForm spec={wrapUpForm} onSubmit={args.onSubmit} initialDraft={answered(wrapUpForm, { activeIndex: 3 })} />,
};

export const WrittenOwnAnswer: Story = {
  name: "单选题 · 自己写把预设项让出来",
  render: (args) => (
    <LiveForm
      spec={wrapUpForm}
      onSubmit={args.onSubmit}
      initialDraft={answered(wrapUpForm, {
        activeIndex: 0,
        answers: { landing: { selectedOptionIds: [], ownText: "先合并，然后把分支删掉" } },
      })}
    />
  ),
};

export const SingleQuestion: Story = {
  name: "只有一题 · 不显示进度",
  render: (args) => <LiveForm spec={singleQuestionForm} onSubmit={args.onSubmit} />,
};

export const FreeText: Story = {
  name: "自由输入题",
  render: (args) => <LiveForm spec={freeTextForm} onSubmit={args.onSubmit} />,
};

export const NarrowWindow: Story = {
  name: "窄窗口 · 说明不截断",
  render: (args) => <LiveForm spec={wrapUpForm} onSubmit={args.onSubmit} width={320} initialDraft={answered(wrapUpForm, { activeIndex: 1 })} />,
};

export const ShortViewport: Story = {
  name: "可用高度不足 · 卡片内部滚动",
  render: (args) => (
    <LiveForm spec={wrapUpForm} onSubmit={args.onSubmit} height={220} initialDraft={answered(wrapUpForm, { activeIndex: 1 })} />
  ),
};

/**
 * 写法不合规（这里是 5 题，超过上限）时，宿主拿到「不可渲染」的判定，输入框上方不出现卡片，
 * 那段内容当普通文字留在正文里——**不向用户解释 Agent 刚才写错了格式**，所以画布上除了
 * 这条普通消息不该再有别的东西。
 */
export const NotRenderable: Story = {
  name: "写法不合规 · 降级成正文",
  render: () => (
    <div className="flex w-[560px] gap-2">
      <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-sel" aria-hidden="true" />
      <p className="whitespace-pre-wrap text-sm text-ink">
        {isRenderableAgentForm(oversizedForm)
          ? "unreachable: oversizedForm 应当判定为不可渲染"
          : oversizedForm.questions.map((question) => question.title).join("\n")}
      </p>
    </div>
  ),
};
