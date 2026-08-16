import type { Config } from "tailwindcss";

const config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "./.storybook/**/*.{ts,tsx}",
    "./node_modules/streamdown/dist/**/*.js",
    "./node_modules/@streamdown/{code,cjk,math,mermaid}/dist/**/*.js",
    "../../node_modules/.pnpm/streamdown@*/node_modules/streamdown/dist/**/*.js",
    "../../node_modules/.pnpm/@streamdown+{code,cjk,math,mermaid}@*/node_modules/@streamdown/*/dist/**/*.js",
  ],
  theme: {
    fontFamily: {
      sans: [
        "InterVar",
        "ui-sans-serif",
        "system-ui",
        "-apple-system",
        "\"Segoe UI\"",
        "Roboto",
        "\"PingFang SC\"",
        "\"Hiragino Sans GB\"",
        "\"Microsoft YaHei\"",
        "sans-serif"
      ],
      mono: ["\"SF Mono\"", "Menlo", "Consolas", "monospace"]
    },
    fontSize: {
      meta: ["11px", { lineHeight: "16px" }],
      xs: ["12px", { lineHeight: "18px" }],
      sm: ["13px", { lineHeight: "20px" }],
      base: ["15px", { lineHeight: "22px" }],
      lg: ["18px", { lineHeight: "26px" }],
      // Markdown H1 only; legacy larger aliases collapse to the UI page-title ceiling.
      xl: ["20px", { lineHeight: "28px" }],
      "2xl": ["18px", { lineHeight: "26px" }],
      "3xl": ["18px", { lineHeight: "26px" }],
      "4xl": ["18px", { lineHeight: "26px" }]
    },
    fontWeight: {
      // Keep compatibility aliases from creating real intermediate weights.
      thin: "400",
      extralight: "400",
      light: "400",
      normal: "400",
      medium: "400",
      semibold: "600",
      bold: "600",
      extrabold: "600",
      black: "600"
    },
    extend: {
      colors: {
        canvas: "var(--canvas)",
        rail: "var(--rail)",
        card: "var(--card)",
        sunken: "var(--sunken)",
        input: "var(--input)",
        ink: "var(--ink)",
        sub: "var(--sub)",
        hint: "var(--hint)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        sel: "var(--sel)",
        hover: "var(--hover)",
        accent: "var(--accent)",
        "accent-fg": "var(--accent-fg)",
        "accent-hover": "var(--accent-hover)",
        pass: "var(--pass)",
        danger: "var(--danger)",
        "ava-bg": "var(--ava-bg)",
        "ava-fg": "var(--ava-fg)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        destructive: "var(--destructive)",
        "destructive-foreground": "var(--destructive-foreground)",
        border: "var(--border)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        ring: "var(--ring)",
        sidebar: "var(--card)"
      },
      boxShadow: {
        overlay: "var(--shadow-pop)",
        panel: "var(--shadow-panel)",
        composer: "var(--shadow-composer)",
        "composer-focus": "var(--shadow-composer-focus)",
        pending: "var(--shadow-pending)"
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        DEFAULT: "var(--dur)"
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease)",
        enter: "var(--ease-enter)"
      },
      keyframes: {
        breathe: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: ".35" }
        },
      },
      animation: {
        breathe: "breathe 2s ease-in-out infinite"
      }
    }
  },
  plugins: []
} satisfies Config;

export default config;
