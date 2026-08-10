import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageAction, MessageToolbar } from "./message-toolbar";
import { FileText } from "lucide-react";

describe("MessageToolbar", () => {
  it("renders the actions it is given", () => {
    render(
      <MessageToolbar>
        <MessageAction icon={FileText} label="完整输出" onClick={() => undefined} />
      </MessageToolbar>,
    );

    expect(screen.getByRole("button", { name: "完整输出" })).toBeInTheDocument();
  });

  it("runs a toolbar action", () => {
    const onClick = vi.fn();
    render(
      <MessageToolbar>
        <MessageAction icon={FileText} label="完整输出" onClick={onClick} />
      </MessageToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
