import type { Decorator, Preview } from "@storybook/react";
import { useEffect, type ReactNode } from "react";
import "../src/styles/globals.css";

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
  decorators: [withTheme],
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
