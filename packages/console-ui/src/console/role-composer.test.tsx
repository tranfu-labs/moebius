import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import {
  ROLE_COMPLETIONS,
  RoleComposer,
  findActiveRoleTrigger,
  hasLegalRoleMention,
  insertRoleMention,
  type RoleCompletion,
} from "./role-composer";
import type { ComposerAttachment } from "./structured-attachments";

const teamRoles: RoleCompletion[] = [
  { handle: "dev", label: "开发", description: "实现功能" },
  { handle: "qa", label: "测试", description: "质量保证" },
];

describe("RoleComposer", () => {
  it("opens seven role options after @ and inserts a legal handle by mouse without losing surrounding text", () => {
    render(<ControlledComposer initialValue="前文 @d 后文" />);
    const input = screen.getByRole("textbox");
    setCaret(input, "前文 @d".length);

    expect(screen.getByRole("listbox", { name: "角色补全面板" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.mouseDown(screen.getByRole("option", { name: /开发/u }));
    expect(input).toHaveValue("前文 @dev 后文");
  });

  it("shows all legal roles for an empty @ trigger", () => {
    render(<ControlledComposer initialValue="@" />);
    const input = screen.getByRole("textbox");
    setCaret(input, 1);

    expect(screen.getAllByRole("option")).toHaveLength(ROLE_COMPLETIONS.length);
    expect(screen.getByRole("option", { name: /技术负责人/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /产品/u })).toBeInTheDocument();
  });

  it("supports keyboard selection and Escape without modifying the value", () => {
    render(<ControlledComposer initialValue="@" />);
    const input = screen.getByRole("textbox");
    setCaret(input, 1);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("@dev ");

    fireEvent.change(input, { target: { value: "@" } });
    setCaret(input, 1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "角色补全面板" })).not.toBeInTheDocument();
    expect(input).toHaveValue("@");
  });

  it("blocks control insertion of a second legal role mention", () => {
    render(<ControlledComposer initialValue="@dev 已在消息里，继续 @" />);
    const input = screen.getByRole("textbox");
    setCaret(input, "@dev 已在消息里，继续 @".length);

    expect(screen.queryByRole("listbox", { name: "角色补全面板" })).not.toBeInTheDocument();
    expect(insertRoleMention("@dev 已在消息里，继续 @", "@dev 已在消息里，继续 @".length, "qa").value).toBe(
      "@dev 已在消息里，继续 @"
    );
  });

  it("ignores inline and fenced code mentions while recognizing real protocol mentions", () => {
    expect(hasLegalRoleMention("`@dev` 只是示例")).toBe(false);
    expect(hasLegalRoleMention("```text\n@qa\n```\n只是示例")).toBe(false);
    expect(hasLegalRoleMention("邮件 a@dev.com 不算角色")).toBe(false);
    expect(hasLegalRoleMention("@unknown 不算角色")).toBe(false);
    expect(hasLegalRoleMention("@product-manager 请确认")).toBe(true);

    expect(findActiveRoleTrigger("`@dev` 继续 @", "`@dev` 继续 @".length)).toEqual({
      start: "`@dev` 继续 ".length,
      end: "`@dev` 继续 @".length,
      query: ""
    });
  });

  it("submits the generated value through the send button", () => {
    const onSubmit = vi.fn();
    render(<ControlledComposer initialValue="@qa 请走查" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /发送/u }));
    expect(onSubmit).toHaveBeenCalledWith("@qa 请走查", []);
  });

  it("does not submit or complete a mention while Enter is confirming IME composition", () => {
    const onSubmit = vi.fn();
    render(<ControlledComposer initialValue="@" onSubmit={onSubmit} roles={teamRoles} />);
    const input = screen.getByRole("textbox");
    setCaret(input, 1);

    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(true);
    expect(input).toHaveValue("@");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "输入完成" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(onSubmit).toHaveBeenCalledWith("输入完成", []);
  });

  it("always leaves Shift+Enter to the textarea instead of submitting or selecting a mention", () => {
    const onSubmit = vi.fn();
    render(<ControlledComposer initialValue="@" onSubmit={onSubmit} roles={teamRoles} />);
    const input = screen.getByRole("textbox");
    setCaret(input, 1);

    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(input).toHaveValue("@");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps primary stop independent from sending while the primary run is active", () => {
    const onInterrupt = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <RoleComposer
        value=""
        onValueChange={vi.fn()}
        onSubmit={onSubmit}
        runActive
        onInterrupt={onInterrupt}
      />,
    );

    const stopButton = screen.getByRole("button", { name: "停下主理人" });
    expect(stopButton).toBeEnabled();
    expect(stopButton.tagName).toBe("BUTTON");
    fireEvent.click(stopButton);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <RoleComposer
        value="补一句话"
        onValueChange={vi.fn()}
        onSubmit={onSubmit}
        runActive
        onInterrupt={onInterrupt}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSubmit).toHaveBeenCalledWith("补一句话", []);
    expect(screen.getByRole("button", { name: "停下主理人" })).toBeVisible();
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("aligns the main stop glyph without changing the embedded stop density", () => {
    const { rerender } = render(
      <RoleComposer
        value=""
        onValueChange={vi.fn()}
        runActive
        onInterrupt={vi.fn()}
        variant="main"
      />,
    );
    const mainStop = screen.getByRole("button", { name: "停下主理人" });
    expect(mainStop).toHaveClass("h-8", "w-8");
    expect(mainStop.querySelector("svg")).toHaveClass("h-4", "w-4");

    rerender(
      <RoleComposer
        value=""
        onValueChange={vi.fn()}
        runActive
        onInterrupt={vi.fn()}
        variant="embedded"
      />,
    );
    const embeddedStop = screen.getByRole("button", { name: "停下主理人" });
    expect(embeddedStop).toHaveClass("h-8", "w-8");
    expect(embeddedStop.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");
  });

  it("isolates the single-line 120px main layout from the embedded composer", () => {
    const { rerender } = render(
      <RoleComposer value="" onValueChange={vi.fn()} variant="main" />,
    );
    const mainInput = screen.getByRole("textbox");
    const mainBox = mainInput.closest("[data-layout-variant='main']");
    expect(screen.getByTestId("main-role-composer")).toContainElement(mainBox as HTMLElement);

    expect(mainInput).toHaveAttribute("rows", "1");
    expect(mainInput).toHaveClass("max-h-[120px]", "min-h-8");
    expect(mainBox).toHaveClass("bg-card", "rounded-xl", "border-line");

    rerender(<RoleComposer value="" onValueChange={vi.fn()} />);
    const embeddedInput = screen.getByRole("textbox");
    expect(embeddedInput).toHaveAttribute("rows", "2");
    expect(embeddedInput).toHaveClass("min-h-[76px]");
    expect(embeddedInput).not.toHaveClass("max-h-[120px]");
    expect(embeddedInput.closest("[data-layout-variant='embedded']")).toHaveClass("bg-input");
    expect(screen.getByTestId("embedded-role-composer")).toContainElement(
      embeddedInput.closest("[data-layout-variant='embedded']") as HTMLElement,
    );
  });

  it("uses only the supplied team's members for completion", () => {
    render(<ControlledComposer initialValue="@" roles={teamRoles} />);
    const input = screen.getByRole("textbox");
    setCaret(input, 1);

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /开发/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /测试/u })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /CEO/u })).not.toBeInTheDocument();
  });

  it("keeps an out-of-team handle as ordinary text while completing a team member", () => {
    const onSubmit = vi.fn();
    render(<ControlledComposer
      initialValue="@ceo 仅作为文本，交给 @"
      roles={teamRoles}
      onSubmit={onSubmit}
    />);
    const input = screen.getByRole("textbox");
    setCaret(input, "@ceo 仅作为文本，交给 @".length);

    fireEvent.mouseDown(screen.getByRole("option", { name: /测试/u }));
    expect(input).toHaveValue("@ceo 仅作为文本，交给 @qa ");
    fireEvent.click(screen.getByRole("button", { name: /发送/u }));
    expect(onSubmit).toHaveBeenCalledWith("@ceo 仅作为文本，交给 @qa ", []);
  });

  it("uses picker, drop, and clipboard images through one files callback", () => {
    const onFilesAdded = vi.fn();
    const { container } = render(
      <RoleComposer value="" onValueChange={vi.fn()} onFilesAdded={onFilesAdded} />,
    );
    const picked = new File(["pdf"], "spec.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [picked] } });
    const dropped = new File(["txt"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(screen.getByRole("textbox").closest(".relative.overflow-hidden")!, {
      dataTransfer: { files: [dropped], types: ["Files"] },
    });
    const pasted = new File(["png"], "paste.png", { type: "image/png" });
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => pasted }],
      },
    });

    expect(onFilesAdded.mock.calls).toEqual([[[picked]], [[dropped]], [[pasted]]]);
  });

  it("submits a pure ready attachment and blocks pending drafts", () => {
    const onSubmit = vi.fn();
    const ready: ComposerAttachment = {
      clientId: "ready",
      attachmentId: "attachment-ready",
      kind: "file",
      displayName: "spec.pdf",
      mediaType: "application/pdf",
      byteSize: 42,
      status: "ready",
    };
    const { rerender } = render(
      <RoleComposer value="" onValueChange={vi.fn()} onSubmit={onSubmit} attachments={[ready]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSubmit).toHaveBeenCalledWith("", ["attachment-ready"]);

    rerender(<RoleComposer
      value="正文"
      onValueChange={vi.fn()}
      onSubmit={onSubmit}
      attachments={[{ ...ready, clientId: "pending", attachmentId: undefined, status: "pending" }]}
    />);
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });

  it("keeps attachment drafts in send mode while a run is active", () => {
    const onSubmit = vi.fn();
    const ready: ComposerAttachment = {
      clientId: "ready-active",
      attachmentId: "attachment-ready-active",
      kind: "file",
      displayName: "spec.pdf",
      mediaType: "application/pdf",
      byteSize: 42,
      status: "ready",
    };
    render(
      <RoleComposer
        value=""
        onValueChange={vi.fn()}
        onSubmit={onSubmit}
        attachments={[ready]}
        runActive
        onInterrupt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSubmit).toHaveBeenCalledWith("", ["attachment-ready-active"]);
    expect(screen.queryByRole("button", { name: "停下当前这一步" })).not.toBeInTheDocument();
  });
});

function ControlledComposer({
  initialValue,
  onSubmit,
  roles,
}: {
  initialValue: string;
  onSubmit?: (value: string) => void;
  roles?: readonly RoleCompletion[];
}): JSX.Element {
  const [value, setValue] = useState(initialValue);
  return <RoleComposer value={value} onValueChange={setValue} onSubmit={onSubmit} roles={roles} />;
}

function setCaret(input: HTMLElement, position: number) {
  const textInput = input as HTMLInputElement;
  textInput.setSelectionRange(position, position);
  fireEvent.focus(textInput);
  fireEvent.select(textInput);
}
