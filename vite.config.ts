/// <reference types="vitest/config" />
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "path";
import {
  defineConfig,
  type PluginOption,
  transformWithOxc,
  type UserConfig,
} from "vite";
import { loadTypeScriptWithoutMissingSourceMap } from "./src/test/viteTypeScript";

// Bundle/treemap analysis is opt-in: `ANALYZE=true pnpm build:renderer`.
const analyze = process.env.ANALYZE === "true";
const pluginRepositoryRoot = /\/plugin-repository\/plugins\//;
const typedSource = /\.[cm]?[jt]sx?(?:\?.*)?$/;
const hostTypedSource =
  /^(?!.*\/plugin-repository\/plugins\/).*\.(?:m?ts|[jt]sx)(?:\?.*)?$/;

// https://vite.dev/config/
export default defineConfig(
  async (): Promise<UserConfig> => ({
    // Relative base so the production build loads over file:// inside Electron.
    base: "./",
    plugins: [
      ...(process.env.VITEST ? [loadTypeScriptWithoutMissingSourceMap()] : []),
      {
        name: "termco:plugin-source",
        enforce: "pre",
        async transform(code, id) {
          if (!pluginRepositoryRoot.test(id) || !typedSource.test(id)) return null;
          return transformWithOxc(code, id, { tsconfig: false });
        },
      },
      babel({
        presets: [reactCompilerPreset({ target: "19" })],
      }),
      react({ exclude: [/\/node_modules\//, pluginRepositoryRoot] }),
      tailwindcss(),
      ...(analyze
        ? [
            (await import("rollup-plugin-visualizer")).visualizer({
              filename: "stats.html",
              template: "treemap",
              gzipSize: true,
              brotliSize: true,
              open: true,
            }) as PluginOption,
          ]
        : []),
    ],
    oxc: {
      include: hostTypedSource,
    },
    resolve: {
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        {
          find: "@termco/kernel",
          replacement: path.resolve(__dirname, "./src/platform/kernel.ts"),
        },
        {
          find: "@termco/ui",
          replacement: path.resolve(__dirname, "./src/platform/ui.ts"),
        },
        {
          find: /^@termco\/(.+-base)$/,
          replacement: path.resolve(
            __dirname,
            "./plugin-repository/plugins/$1/src/index.ts",
          ),
        },
      ],
    },
    build: {
      outDir: "dist",
      target: "es2022",
      chunkSizeWarningLimit: 1500,
      rolldownOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
        },
        treeshake: {
          manualPureFunctions: ["console.debug", "console.info", "console.trace"],
        },
        output: {
          manualChunks(id: string) {
            if (id.includes("vite/preload-helper") || id.includes("/vite/dist/"))
              return "react";
            if (!id.includes("node_modules")) return null;
            if (
              id.includes("/clsx/") ||
              id.includes("/tailwind-merge/") ||
              id.includes("/class-variance-authority/")
            )
              return "react";
            if (id.includes("@ai-sdk/anthropic")) return "ai-anthropic";
            if (id.includes("@ai-sdk/google")) return "ai-google";
            if (id.includes("@ai-sdk/openai-compatible")) return "ai-openai-compat";
            if (id.includes("@ai-sdk/openai")) return "ai-openai";
            if (id.includes("@ai-sdk/cerebras")) return "ai-cerebras";
            if (id.includes("@ai-sdk/groq")) return "ai-groq";
            if (id.includes("@ai-sdk/xai")) return "ai-xai";
            if (id.includes("@ai-sdk/")) return "ai-sdk-shared";
            // The BPE ranks are a couple of MB of data. Its own chunk, loaded
            // lazily on the first token count, keeps it out of the main bundle.
            if (id.includes("gpt-tokenizer")) return "tokenizer";
            if (id.includes("@wterm/")) return "wterm";
            {
              const m = id.match(/@codemirror\/lang-([\w-]+)/);
              if (m) return `cm-lang-${m[1]}`;
            }
            {
              const m = id.match(/@codemirror\/legacy-modes\/mode\/([\w-]+)/);
              if (m) return `cm-legacy-${m[1]}`;
            }
            if (
              id.includes("@codemirror/") ||
              id.includes("@uiw/codemirror") ||
              id.includes("@replit/codemirror")
            )
              return "codemirror";
            if (id.includes("/streamdown/") || id.includes("@streamdown/"))
              return "streamdown";
            if (
              id.includes("/react-dom/") ||
              id.includes("/react/") ||
              id.includes("/scheduler/")
            )
              return "react";
            if (id.includes("@radix-ui/") || id.includes("/radix-ui/"))
              return "radix";
            return null;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["src/test/setupEnvironment.ts"],
      // Unit tests live under src/. Exclude e2e/ (Playwright specs) and electron/
      // (run via vitest.electron.config.ts) so vitest doesn't try to collect them.
      include: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "plugin-repository/plugins/**/*.{test,spec}.{ts,tsx}",
        "core-plugins/**/*.{test,spec}.{ts,tsx}",
      ],
      exclude: ["e2e/**", "electron/**", "node_modules/**", "dist/**", "dist-electron/**"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/**/*.d.ts",
          "src/main.tsx",
        ],
        reporter: ["text-summary", "json-summary", "html"],
      },
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        // Playwright artifacts land under e2e/ while the dev server runs —
        // without these ignores every E2E run spams full page reloads.
        ignored: [
          "**/e2e/.report/**",
          "**/e2e/.output/**",
          "**/e2e/.perf/**",
        ],
      },
    },
  }),
);
