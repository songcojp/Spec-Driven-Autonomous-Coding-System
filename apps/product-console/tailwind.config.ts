import type { Config } from "tailwindcss";

export default {
  content: ["apps/product-console/index.html", "apps/product-console/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18212f",
        muted: "#657083",
        line: "#d8dee8",
        canvas: "#f7f9fc",
        panel: "#ffffff",
        action: "#0875d1",
        teal: "#0f9f8f",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(24, 33, 47, 0.04), 0 12px 30px rgba(24, 33, 47, 0.06)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
