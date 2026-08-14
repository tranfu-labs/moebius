import type { Decorator, Preview } from "@storybook/react";
import { useEffect, type ReactNode } from "react";
import {
  operatorConsoleAppearanceClassName,
  type OperatorConsoleAppearance,
} from "../src/console/operator-console-appearance";
import { cn } from "../src/lib/utils";
import "../src/styles/globals.css";

const withOperatorConsoleAppearance: Decorator = (Story, context) => {
  const appearance: OperatorConsoleAppearance = context.args.appearance === "focused"
    ? "focused"
    : "default";

  return (
    <div
      className={cn("contents", operatorConsoleAppearanceClassName(appearance))}
      data-appearance={appearance}
    >
      <Story />
    </div>
  );
};

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as "light" | "dark" | undefined;
  const fullscreen =
    context.title.startsWith("Page/") || context.parameters.layout === "fullscreen";

  return (
    <ThemeFrame fullscreen={fullscreen} theme={theme ?? "light"}>
      <Story />
    </ThemeFrame>
  );
};

function ThemeFrame({
  children,
  fullscreen,
  theme,
}: {
  children: ReactNode;
  fullscreen: boolean;
  theme: "light" | "dark";
}): JSX.Element {
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
    return () => {
      document.documentElement.classList.remove("light", "dark");
    };
  }, [theme]);

  return (
    <div className={`min-h-screen bg-canvas text-ink${fullscreen ? "" : " p-6"}`}>
      {children}
    </div>
  );
}

const preview: Preview = {
  decorators: [withTheme, withOperatorConsoleAppearance],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" }
        ],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: {
    theme: "light"
  },
  parameters: {
    options: {
      storySort: {
        order: ["Component", "Block", "Page"],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    }
  }
};

export default preview;
