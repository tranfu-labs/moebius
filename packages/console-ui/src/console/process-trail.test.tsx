import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { escapeTerminalControlCharacters, ProcessTrail, type ProcessStep } from "./process-trail";

const steps: ProcessStep[] = [
  { id: "1", kind: "thinking", title: "先看官网构建是否通过", input: "先核对构建，再检查分享卡片。", output: null, status: "done" },
  { id: "2", kind: "command", title: "运行命令", detail: "构建 marketing-site", input: "pnpm --filter marketing-site build", output: "build complete", status: "done" },
  { id: "3", kind: "file", title: "读取文件", detail: "share-card.tsx", input: "/repo/share-card.tsx", output: null, status: "running" },
];

describe("ProcessTrail", () => {
  it("keeps every step visible while the run is live", () => {
    render(<ProcessTrail steps={steps} />);

    expect(screen.getByText("先看官网构建是否通过")).toBeVisible();
    expect(screen.getByText("构建 marketing-site")).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("opens multiple steps in place with input before output", () => {
    render(<ProcessTrail steps={steps} />);

    const thinking = screen.getByRole("button", { name: /展开步骤：先看官网构建是否通过/u });
    const command = screen.getByRole("button", { name: /展开步骤：运行命令 构建 marketing-site/u });
    fireEvent.click(thinking);
    fireEvent.click(command);

    expect(thinking).toHaveAttribute("aria-expanded", "true");
    expect(command).toHaveAttribute("aria-expanded", "true");
    const labels = screen.getAllByText(/^(?:思考|命令|结果)$/u).map((label) => label.textContent);
    expect(labels).toEqual(["思考", "命令", "结果"]);
    expect(screen.getByText("pnpm --filter marketing-site build")).toBeVisible();
    expect(screen.getByText("build complete")).toBeVisible();
  });

  it("keeps an expanded step open when a live step is appended", () => {
    const { rerender } = render(<ProcessTrail steps={steps} />);
    const command = screen.getByRole("button", { name: /展开步骤：运行命令/u });
    fireEvent.click(command);

    rerender(<ProcessTrail steps={[...steps, { id: "4", kind: "search", title: "搜索", detail: "ProcessTrail" }]} />);

    expect(screen.getByRole("button", { name: /收起步骤：运行命令/u })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("build complete")).toBeVisible();
  });

  it("shows a readable inline failure and bounded-output notice", () => {
    render(<ProcessTrail steps={[{
      id: "failed",
      kind: "command",
      title: "运行测试",
      status: "failed",
      input: "pnpm test",
      output: "FAIL process-trail.test.tsx",
      outputRemainingLines: 18,
      error: "exit code 1\nProcessTrail keyboard interaction failed",
    }]} />);

    expect(screen.getByText(/ProcessTrail keyboard interaction failed/u)).toBeVisible();
    expect(screen.queryByText(/exit code 1/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /展开步骤：运行测试/u }));
    expect(screen.getByText("还有 18 行未显示，请在完整输出中查看")).toBeVisible();
  });

  it("explains legacy missing details instead of rendering an empty panel", () => {
    render(<ProcessTrail steps={[{ id: "legacy", kind: "tool", title: "调用工具", status: "done" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /展开步骤：调用工具/u }));
    expect(screen.getByText("当前执行引擎未记录这部分内容")).toBeVisible();
  });

  it("renders one missing-output section when an older record only stored input", () => {
    render(<ProcessTrail steps={[{
      id: "input-only",
      kind: "command",
      title: "运行旧命令",
      input: "pnpm test",
      status: "done",
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: /展开步骤：运行旧命令/u }));

    expect(screen.getAllByText("结果")).toHaveLength(1);
    expect(screen.getAllByText("当前执行引擎未记录这部分内容")).toHaveLength(1);
  });

  it("renders detail content as inert selectable text", () => {
    const { container } = render(<ProcessTrail steps={[{
      id: "plain",
      kind: "tool",
      title: "读取返回",
      input: "**not bold**",
      output: "<script>window.bad = true</script>",
      status: "done",
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: /展开步骤：读取返回/u }));
    expect(screen.getByText("**not bold**")).toBeVisible();
    expect(screen.getByText("<script>window.bad = true</script>")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });

  it("folds into one line once the answer landed, and reopens on demand", () => {
    render(<ProcessTrail steps={steps} collapsed />);

    const summary = screen.getByRole("button", { name: /思考与工具调用 · 3 步/u });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    const content = document.getElementById(summary.getAttribute("aria-controls") ?? "");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(content).toHaveStyle({ gridTemplateRows: "0fr", opacity: "0" });

    fireEvent.click(summary);

    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveAttribute("aria-hidden", "false");
    expect(content).toHaveStyle({ gridTemplateRows: "1fr", opacity: "1" });
    expect(screen.getByText("先看官网构建是否通过")).toBeVisible();
  });

  it("uses tokenized interruptible disclosure motion with a reduced-motion fallback", () => {
    render(<ProcessTrail steps={steps} collapsed />);

    const summary = screen.getByRole("button", { name: /思考与工具调用 · 3 步/u });
    const content = document.getElementById(summary.getAttribute("aria-controls") ?? "");
    expect(content).toHaveClass(
      "transition-[grid-template-rows,opacity]",
      "[transition-duration:var(--dur)]",
      "[transition-timing-function:var(--ease)]",
      "motion-reduce:transition-none",
    );

    fireEvent.click(summary);
    expect(content).toHaveAttribute("data-state", "open");
  });

  it("renders nothing without steps", () => {
    const { container } = render(<ProcessTrail steps={[]} collapsed />);
    expect(container).toBeEmptyDOMElement();
  });

  it("escapes terminal control characters into visible pictures inside expanded details", () => {
    render(<ProcessTrail steps={[{
      id: "ansi",
      kind: "command",
      title: "运行测试",
      status: "failed",
      input: "printf '\u001b[31mred\u001b[0m'",
      output: "\u001b[31mred\u001b[0m\u0000\u007f",
      error: "\u001b[31mfailed\u001b[0m",
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /展开步骤：运行测试/u }));

    expect(screen.getByText(/printf '␛\[31mred␛\[0m'/u)).toBeVisible();
    expect(screen.getByText(/␛\[31mred␛\[0m␀␡/u)).toBeVisible();
    expect(screen.getByText(/␛\[31mfailed␛\[0m/u)).toBeVisible();
    // 真实的 ESC、NUL、DEL 不得进入 DOM。
    expect(document.body.textContent).not.toContain("\u001b");
    expect(document.body.textContent).not.toContain("\u0000");
    expect(document.body.textContent).not.toContain("\u007f");
  });
});

describe("escapeTerminalControlCharacters", () => {
  it("maps ESC to the escape picture and other C0 controls plus DEL to control pictures", () => {
    expect(escapeTerminalControlCharacters("a\u001b[31mb\u001b[0m")).toBe("a␛[31mb␛[0m");
    expect(escapeTerminalControlCharacters("\u0000")).toBe("␀");
    expect(escapeTerminalControlCharacters("\u0007")).toBe("␇");
    expect(escapeTerminalControlCharacters("\u007f")).toBe("␡");
  });

  it("keeps layout characters and ordinary text untouched", () => {
    expect(escapeTerminalControlCharacters("line one\nline two\ttabbed\r\n")).toBe(
      "line one\nline two\ttabbed\r\n",
    );
    expect(escapeTerminalControlCharacters("纯文本 content")).toBe("纯文本 content");
  });
});
