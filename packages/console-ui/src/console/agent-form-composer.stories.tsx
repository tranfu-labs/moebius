import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { AgentFormCard } from "@/console/agent-form-card";
import { createAgentFormDraft, type AgentFormDraft, type AgentFormSpec } from "@/console/agent-form-model";
import { RoleComposer } from "@/console/role-composer";
import { RoleTag } from "@/console/role-tag";
import type { ComposerAttachment } from "@/console/structured-attachments";
import type { ComposerTextFragment } from "@/console/text-fragment-list";

const form: AgentFormSpec = {
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
        { id: "workspace", title: "删掉这次用的独立工作空间" },
        { id: "logs", title: "清掉本地跑出来的日志" },
      ],
    },
    { id: "note", kind: "text", title: "还有什么要我知道的" },
  ],
};

const draftAttachment: ComposerAttachment = {
  clientId: "draft-file",
  attachmentId: "draft-file",
  kind: "file",
  displayName: "收尾清单.md",
  mediaType: "text/markdown",
  byteSize: 3_182,
  status: "ready",
};

const draftFragment: ComposerTextFragment = {
  id: "draft-fragment",
  label: "从右侧栏引用",
  text: "第 42 行的那个分支没有覆盖到空数组",
};

interface TimelineMessage {
  id: string;
  text: string;
}

/**
 * The stacking the product fixes: the form is the outermost thing above the composer,
 * and the user's own draft — attachments, quoted text — stays closest to the input.
 */
function FormAboveComposer({
  withDraftItems,
}: {
  withDraftItems: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState<AgentFormDraft>(() => createAgentFormDraft(form));
  const [formVisible, setFormVisible] = useState(true);
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<readonly TimelineMessage[]>([]);

  function append(text: string): void {
    setMessages((current) => [...current, { id: `message-${current.length}`, text }]);
  }

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-[840px] flex-col gap-4">
          <div className="flex gap-2">
            <RoleTag label={form.memberName} toneKey={form.memberSlug} engine={form.engine} className="mt-0.5" />
            <p className="text-sm text-ink">
              改动都做完了，测试也跑过了。收尾方式我拿不准，问你几件事。
            </p>
          </div>
          {messages.map((message) => (
            <div key={message.id} className="flex flex-col items-end gap-1">
              <span className="text-meta text-hint">你</span>
              <p className="max-w-[75%] whitespace-pre-wrap rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink">
                {message.text}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="px-8 pb-6">
        <div className="mx-auto flex w-full max-w-[840px] flex-col gap-2">
          {formVisible ? (
            <AgentFormCard
              spec={form}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={(message) => {
                append(message);
                setFormVisible(false);
              }}
            />
          ) : null}
          <RoleComposer
            value={value}
            onValueChange={setValue}
            attachments={withDraftItems ? [draftAttachment] : []}
            textFragments={withDraftItems ? [draftFragment] : []}
            onSubmit={(text) => {
              if (text.trim().length === 0) return;
              append(text);
              setValue("");
            }}
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Block/Console/AgentFormComposer",
  component: FormAboveComposer,
  args: { withDraftItems: true },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FormAboveComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FormAboveDraft: Story = {
  name: "表单在最上，用户自己的东西贴着输入框",
  render: () => <FormAboveComposer withDraftItems />,
};

export const BypassTheForm: Story = {
  name: "绕开表单 · 直接打字发送后表单还在",
  render: () => <FormAboveComposer withDraftItems={false} />,
};
