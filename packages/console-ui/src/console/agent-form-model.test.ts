import { describe, expect, it } from "vitest";

import {
  answeredQuestionCount,
  applyOwnText,
  canSubmitAgentForm,
  composeAgentFormMessage,
  createAgentFormDraft,
  isQuestionAnswered,
  isRenderableAgentForm,
  resolveAgentFormDraft,
  toggleOption,
  type AgentFormChoiceQuestion,
  type AgentFormSpec,
} from "./agent-form-model";

const single: AgentFormChoiceQuestion = {
  id: "wrap-up",
  kind: "single",
  title: "这段做完怎么收尾",
  options: [
    { id: "merge", title: "合并进主线", description: "改动已经自测过" },
    { id: "keep", title: "先留在分支上", description: "还想再看两天" },
  ],
};

const multiple: AgentFormChoiceQuestion = {
  id: "cleanup",
  kind: "multiple",
  title: "顺手清理哪些东西",
  options: [
    { id: "workspace", title: "删掉独立工作空间" },
    { id: "logs", title: "清掉本地日志" },
  ],
};

const spec: AgentFormSpec = {
  id: "form-1",
  memberName: "开发",
  memberSlug: "dev",
  questions: [
    single,
    multiple,
    { id: "note", kind: "text", title: "还有什么要交代的" },
  ],
};

describe("agent form size limits", () => {
  it("accepts a form inside the product limits", () => {
    expect(isRenderableAgentForm(spec)).toBe(true);
  });

  it("rejects a fifth question", () => {
    const oversized: AgentFormSpec = {
      ...spec,
      questions: [1, 2, 3, 4, 5].map((index) => ({
        id: `q${index}`,
        kind: "text" as const,
        title: `第 ${index} 题`,
      })),
    };
    expect(isRenderableAgentForm(oversized)).toBe(false);
  });

  it("rejects a third preset option on a choice question", () => {
    const crowded: AgentFormSpec = {
      ...spec,
      questions: [{
        ...single,
        options: [...single.options, { id: "drop", title: "直接丢掉" }],
      }],
    };
    expect(isRenderableAgentForm(crowded)).toBe(false);
  });

  it("rejects empty forms, blank titles, duplicate ids and option-less choices", () => {
    expect(isRenderableAgentForm({ ...spec, questions: [] })).toBe(false);
    expect(isRenderableAgentForm({ ...spec, questions: [{ ...single, title: "  " }] })).toBe(false);
    expect(isRenderableAgentForm({ ...spec, questions: [single, single] })).toBe(false);
    expect(isRenderableAgentForm({ ...spec, questions: [{ ...single, options: [] }] })).toBe(false);
    expect(isRenderableAgentForm({ ...spec, memberName: " " })).toBe(false);
  });
});

describe("agent form draft", () => {
  it("discards a draft that belongs to another form", () => {
    const stale = { formId: "form-0", activeIndex: 2, answers: { "wrap-up": { selectedOptionIds: ["merge"], ownText: "" } } };
    expect(resolveAgentFormDraft(spec, stale)).toEqual(createAgentFormDraft(spec));
  });

  it("clamps an out-of-range question index", () => {
    const draft = { formId: "form-1", activeIndex: 9, answers: {} };
    expect(resolveAgentFormDraft(spec, draft).activeIndex).toBe(2);
  });

  it("counts a question as answered once anything is selected or written", () => {
    let draft = createAgentFormDraft(spec);
    expect(canSubmitAgentForm(spec, draft)).toBe(false);

    draft = toggleOption(draft, single, "merge");
    expect(isQuestionAnswered(draft, single)).toBe(true);
    expect(canSubmitAgentForm(spec, draft)).toBe(true);

    draft = toggleOption(draft, single, "merge");
    // Re-picking the same single-choice option keeps it selected; only text clears it.
    expect(isQuestionAnswered(draft, single)).toBe(true);

    draft = applyOwnText(draft, spec.questions[2]!, "   ");
    expect(isQuestionAnswered(draft, spec.questions[2]!)).toBe(false);
  });

  it("lets a written answer release the preset on a single-choice question", () => {
    let draft = toggleOption(createAgentFormDraft(spec), single, "merge");
    draft = applyOwnText(draft, single, "先合并再删分支");
    expect(draft.answers["wrap-up"]).toEqual({ selectedOptionIds: [], ownText: "先合并再删分支" });

    draft = applyOwnText(draft, single, "");
    expect(isQuestionAnswered(draft, single)).toBe(false);
  });

  it("keeps presets and the written answer together on a multiple-choice question", () => {
    let draft = toggleOption(createAgentFormDraft(spec), multiple, "logs");
    draft = toggleOption(draft, multiple, "workspace");
    draft = applyOwnText(draft, multiple, "顺手更新一下 README");
    expect(draft.answers["cleanup"]).toEqual({
      // Selections come back in the order the form declares them, not the click order.
      selectedOptionIds: ["workspace", "logs"],
      ownText: "顺手更新一下 README",
    });

    draft = toggleOption(draft, multiple, "logs");
    expect(draft.answers["cleanup"]?.selectedOptionIds).toEqual(["workspace"]);
    expect(answeredQuestionCount(spec, draft)).toBe(1);
  });
});

describe("agent form message", () => {
  const format = { line: "{question}：{answer}", answerJoin: "、" };

  it("writes one line per answered question and skips the rest", () => {
    let draft = toggleOption(createAgentFormDraft(spec), single, "keep");
    draft = toggleOption(draft, multiple, "workspace");
    draft = toggleOption(draft, multiple, "logs");

    expect(composeAgentFormMessage(spec, draft, format)).toBe(
      "这段做完怎么收尾：先留在分支上\n顺手清理哪些东西：删掉独立工作空间、清掉本地日志",
    );
  });

  it("never carries a description into the message", () => {
    const draft = toggleOption(createAgentFormDraft(spec), single, "merge");
    const message = composeAgentFormMessage(spec, draft, format);
    expect(message).toBe("这段做完怎么收尾：合并进主线");
    expect(message).not.toContain("改动已经自测过");
  });

  it("puts the written answer after the presets it was chosen alongside", () => {
    let draft = toggleOption(createAgentFormDraft(spec), multiple, "workspace");
    draft = applyOwnText(draft, multiple, "还有 .env.local");
    draft = applyOwnText(draft, spec.questions[2]!, "  周五之前给我  ");

    expect(composeAgentFormMessage(spec, draft, format)).toBe(
      "顺手清理哪些东西：删掉独立工作空间、还有 .env.local\n还有什么要交代的：周五之前给我",
    );
  });

  it("uses the format it is given, so English is not hard-coded punctuation", () => {
    let draft = toggleOption(createAgentFormDraft(spec), multiple, "workspace");
    draft = toggleOption(draft, multiple, "logs");
    expect(composeAgentFormMessage(spec, draft, { line: "{question}: {answer}", answerJoin: ", " }))
      .toBe("顺手清理哪些东西: 删掉独立工作空间, 清掉本地日志");
  });

  it("is empty when nothing was answered", () => {
    expect(composeAgentFormMessage(spec, createAgentFormDraft(spec), format)).toBe("");
  });
});
