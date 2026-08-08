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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      boxShadow: {
        overlay: "var(--shadow-pop)"
      },
      fontFamily: {
        display: ["var(--font-display)"],
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
      fontWeight: {
        medium: "510",
        semibold: "590"
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
        // Overlays fade only. Scaling or sliding one in is the "位移缩放飞入" the motion
        // red line rules out, and opacity is the one channel that carries no direction.
        "overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" }
        },
        "overlay-out": {
          from: { opacity: "1" },
          to: { opacity: "0" }
        }
      },
      animation: {
        breathe: "breathe 2s ease-in-out infinite",
        "overlay-in": "overlay-in var(--dur-fast) var(--ease-enter)",
        "overlay-out": "overlay-out var(--dur-fast) var(--ease)"
      }
    }
  },
  plugins: []
} satisfies Config;

export default config;
