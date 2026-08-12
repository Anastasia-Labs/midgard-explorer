/**
 * This package ships one design-token stylesheet and no runtime code, so it
 * had no TypeScript inputs and its `tsc --noEmit` failed the whole workspace
 * typecheck with TS18003.
 *
 * The fix is an entry point rather than a deleted script: the check stays wired
 * up for the day a token helper does land here, and a consumer gets one name
 * for the stylesheet instead of a path string repeated across the app.
 */

/** Import specifier for the design tokens. Use it in a bundler entry:
 * `import UI_TOKENS_CSS from "@midgard-explorer/ui/src/tokens.css"`. */
export const UI_TOKENS_CSS = "@midgard-explorer/ui/src/tokens.css" as const;
