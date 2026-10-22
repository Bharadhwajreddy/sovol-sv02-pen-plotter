import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        tx: "var(--ui-text)",
        tx2: "var(--ui-text-2)",
        tx3: "var(--ui-text-3)",
        ink: "var(--ui-ink)",
        ink2: "var(--ui-ink-2)",
        terra: "var(--ui-terra)",
        gold: "var(--ui-gold)",
        okc: "var(--ui-ok)",
        errc: "var(--ui-err)",
        warnc: "var(--ui-warn)",
        paper: "var(--ui-panel)",
        paper2: "var(--ui-panel-2)",
        background: "#0f0f0f",
        surface: "#1a1a1a",
        border: "#2a2a2a",
        accent: "#3b82f6",
        "accent-hover": "#2563eb",
        muted: "#6b7280",
        subtle: "#374151",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
