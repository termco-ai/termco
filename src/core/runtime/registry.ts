/**
 * Shared renderer runtime for independently compiled plugins.
 *
 * The registry exposes one application-wide instance of declared packages and
 * the two public Termco module surfaces. Product/private application modules
 * are deliberately absent; plugins collaborate through injected services.
 */

export type RuntimeModuleLoader = () => Promise<unknown>;

const NPM_MODULES: Record<string, RuntimeModuleLoader> = {
  react: () => import("react"),
  "react-dom": () => import("react-dom"),
  "react/jsx-runtime": () => import("react/jsx-runtime"),
  streamdown: () => import("streamdown"),
  zustand: () => import("zustand"),
  sonner: () => import("sonner"),
  "@tanstack/react-virtual": () => import("@tanstack/react-virtual"),
  "@hugeicons/react": () => import("@hugeicons/react"),
  "@hugeicons/core-free-icons": () => import("@hugeicons/core-free-icons"),
  "@iconify-json/catppuccin": () => import("@iconify-json/catppuccin"),
  "@codemirror/search": () => import("@codemirror/search"),
  "@codemirror/autocomplete": () => import("@codemirror/autocomplete"),
  "@codemirror/commands": () => import("@codemirror/commands"),
  "@codemirror/lang-css": () => import("@codemirror/lang-css"),
  "@codemirror/lang-go": () => import("@codemirror/lang-go"),
  "@codemirror/lang-html": () => import("@codemirror/lang-html"),
  "@codemirror/lang-javascript": () => import("@codemirror/lang-javascript"),
  "@codemirror/lang-json": () => import("@codemirror/lang-json"),
  "@codemirror/lang-markdown": () => import("@codemirror/lang-markdown"),
  "@codemirror/lang-php": () => import("@codemirror/lang-php"),
  "@codemirror/lang-python": () => import("@codemirror/lang-python"),
  "@codemirror/lang-rust": () => import("@codemirror/lang-rust"),
  "@codemirror/lang-vue": () => import("@codemirror/lang-vue"),
  "@codemirror/language": () => import("@codemirror/language"),
  "@codemirror/legacy-modes/mode/clike": () =>
    import("@codemirror/legacy-modes/mode/clike"),
  "@codemirror/legacy-modes/mode/clojure": () =>
    import("@codemirror/legacy-modes/mode/clojure"),
  "@codemirror/legacy-modes/mode/cmake": () =>
    import("@codemirror/legacy-modes/mode/cmake"),
  "@codemirror/legacy-modes/mode/diff": () =>
    import("@codemirror/legacy-modes/mode/diff"),
  "@codemirror/legacy-modes/mode/dockerfile": () =>
    import("@codemirror/legacy-modes/mode/dockerfile"),
  "@codemirror/legacy-modes/mode/groovy": () =>
    import("@codemirror/legacy-modes/mode/groovy"),
  "@codemirror/legacy-modes/mode/haskell": () =>
    import("@codemirror/legacy-modes/mode/haskell"),
  "@codemirror/legacy-modes/mode/lua": () =>
    import("@codemirror/legacy-modes/mode/lua"),
  "@codemirror/legacy-modes/mode/nginx": () =>
    import("@codemirror/legacy-modes/mode/nginx"),
  "@codemirror/legacy-modes/mode/perl": () =>
    import("@codemirror/legacy-modes/mode/perl"),
  "@codemirror/legacy-modes/mode/powershell": () =>
    import("@codemirror/legacy-modes/mode/powershell"),
  "@codemirror/legacy-modes/mode/properties": () =>
    import("@codemirror/legacy-modes/mode/properties"),
  "@codemirror/legacy-modes/mode/protobuf": () =>
    import("@codemirror/legacy-modes/mode/protobuf"),
  "@codemirror/legacy-modes/mode/r": () =>
    import("@codemirror/legacy-modes/mode/r"),
  "@codemirror/legacy-modes/mode/ruby": () =>
    import("@codemirror/legacy-modes/mode/ruby"),
  "@codemirror/legacy-modes/mode/shell": () =>
    import("@codemirror/legacy-modes/mode/shell"),
  "@codemirror/legacy-modes/mode/sql": () =>
    import("@codemirror/legacy-modes/mode/sql"),
  "@codemirror/legacy-modes/mode/stex": () =>
    import("@codemirror/legacy-modes/mode/stex"),
  "@codemirror/legacy-modes/mode/swift": () =>
    import("@codemirror/legacy-modes/mode/swift"),
  "@codemirror/legacy-modes/mode/toml": () =>
    import("@codemirror/legacy-modes/mode/toml"),
  "@codemirror/legacy-modes/mode/vb": () =>
    import("@codemirror/legacy-modes/mode/vb"),
  "@codemirror/legacy-modes/mode/xml": () =>
    import("@codemirror/legacy-modes/mode/xml"),
  "@codemirror/legacy-modes/mode/yaml": () =>
    import("@codemirror/legacy-modes/mode/yaml"),
  "@codemirror/lint": () => import("@codemirror/lint"),
  "@codemirror/merge": () => import("@codemirror/merge"),
  "@codemirror/state": () => import("@codemirror/state"),
  "@codemirror/view": () => import("@codemirror/view"),
  "@lezer/highlight": () => import("@lezer/highlight"),
  "@replit/codemirror-vim": () => import("@replit/codemirror-vim"),
  "@uiw/codemirror-theme-atomone": () =>
    import("@uiw/codemirror-theme-atomone"),
  "@uiw/codemirror-theme-aura": () => import("@uiw/codemirror-theme-aura"),
  "@uiw/codemirror-theme-copilot": () =>
    import("@uiw/codemirror-theme-copilot"),
  "@uiw/codemirror-theme-github": () => import("@uiw/codemirror-theme-github"),
  "@uiw/codemirror-theme-gruvbox-dark": () =>
    import("@uiw/codemirror-theme-gruvbox-dark"),
  "@uiw/codemirror-theme-nord": () => import("@uiw/codemirror-theme-nord"),
  "@uiw/codemirror-theme-tokyo-night": () =>
    import("@uiw/codemirror-theme-tokyo-night"),
  "@uiw/codemirror-theme-xcode": () => import("@uiw/codemirror-theme-xcode"),
  "@uiw/codemirror-themes": () => import("@uiw/codemirror-themes"),
  "@wterm/core": () => import("@wterm/core"),
  "@wterm/dom": () => import("@wterm/dom"),
  "@wterm/ghostty": () => import("@wterm/ghostty"),
  "react-resizable-panels": () => import("react-resizable-panels"),
  "@uiw/react-codemirror": async () =>
    (await import("@uiw/react-codemirror")).default,
  "@ai-sdk/react": () => import("@ai-sdk/react"),
  "@radix-ui/react-use-controllable-state": () =>
    import("@radix-ui/react-use-controllable-state"),
  recharts: () => import("recharts"),
  "use-stick-to-bottom": () => import("use-stick-to-bottom"),
  ai: () => import("ai"),
  zod: () => import("zod"),
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic"),
  "@ai-sdk/openai": () => import("@ai-sdk/openai"),
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible"),
  "@ai-sdk/google": () => import("@ai-sdk/google"),
  "@ai-sdk/groq": () => import("@ai-sdk/groq"),
  "@ai-sdk/cerebras": () => import("@ai-sdk/cerebras"),
  "@ai-sdk/xai": () => import("@ai-sdk/xai"),
  "gpt-tokenizer/encoding/o200k_base": () =>
    import("gpt-tokenizer/encoding/o200k_base"),
};

const PUBLIC_TERMCO_MODULES: Record<string, RuntimeModuleLoader> = {
  kernel: () => import("@/platform/kernel"),
  ui: async () => (await import("@/platform/ui")).default,
};

export const RUNTIME_MODULES: Record<string, RuntimeModuleLoader> = {
  ...NPM_MODULES,
  ...PUBLIC_TERMCO_MODULES,
};

export function runtimeModuleNames(): string[] {
  return Object.keys(RUNTIME_MODULES).sort();
}

declare global {
  // eslint-disable-next-line no-var
  var __termcoRuntime: Record<string, RuntimeModuleLoader> | undefined;
}

export function installRuntimeModules(): void {
  globalThis.__termcoRuntime = RUNTIME_MODULES;
}
