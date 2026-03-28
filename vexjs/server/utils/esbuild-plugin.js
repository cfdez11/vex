import path from "path";
import { SRC_DIR, PROJECT_ROOT } from "./files.js";

/**
 * Creates the VexJS esbuild alias plugin.
 *
 * esbuild resolves imports by looking at the specifier string (e.g. "vex/reactive",
 * "./utils/counter", "lodash"). By default it only understands relative paths and
 * node_modules. This plugin teaches esbuild about the three VexJS-specific import
 * conventions so it can correctly bundle every <script client> block.
 *
 * The plugin intercepts imports at bundle time via onResolve hooks — each hook
 * matches a filter regex against the import specifier and returns either:
 *   - { path, external: true }  → esbuild leaves the import as-is in the output.
 *                                  The browser resolves it at runtime from the URL.
 *   - { path }                  → esbuild reads and inlines the file into the bundle.
 *
 * ─── Three categories of imports ────────────────────────────────────────────
 *
 * 1. Framework singletons  (vex/*)
 *    Examples: `import { reactive } from 'vex/reactive'`
 *
 *    These are framework runtime files served statically at /_vexjs/services/.
 *    They MUST be marked external so every component shares the same instance
 *    at runtime. If esbuild inlined them, each component bundle would get its
 *    own copy of reactive.js — reactive state would not be shared across
 *    components on the same page and the entire reactivity system would break.
 *
 *    The path is rewritten from the short alias to the browser-accessible URL:
 *      vex/reactive  →  /_vexjs/services/reactive.js  (external)
 *
 * 2. Project alias  (@/*)
 *    Example: `import { counter } from '@/utils/counter'`
 *
 *    @/ is a shorthand for the project SRC_DIR root. These files are served as
 *    singleton modules at /_vexjs/user/ — the browser's ES module cache ensures
 *    all components share the same instance (same reactive state, same store).
 *
 * 3. Relative imports  (./ and ../)
 *    Example: `import { fn } from './helpers'`
 *
 *    Treated the same as @/ — marked external and served at /_vexjs/user/.
 *    This gives the same singleton guarantee as @/ imports: two components that
 *    import the same file via different relative paths both resolve to the same
 *    URL, so the browser module cache returns the same instance.
 *
 *    Note: .vex component imports are stripped from clientImports before
 *    reaching esbuild, so this hook only fires for .js user utility files.
 *
 * 4. npm packages  (bare specifiers like 'lodash', 'date-fns')
 *    Also resolved automatically by esbuild via node_modules lookup.
 *    No custom hook is needed.
 *
 * @returns {import('esbuild').Plugin}
 */
export function createVexAliasPlugin() {
  return {
    name: "vex-aliases",
    setup(build) {
      // ── Category 1a: vex/* ────────────────────────────────────────────────
      // Matches: 'vex/reactive', 'vex/html', 'vex/navigation', etc.
      // Rewrites to the browser URL and marks external so esbuild skips bundling.
      build.onResolve({ filter: /^vex\// }, (args) => {
        let mod = args.path.replace(/^vex\//, "");
        if (!path.extname(mod)) mod += ".js";
        return { path: `/_vexjs/services/${mod}`, external: true };
      });

      // ── Category 2: @/ project alias ─────────────────────────────────────
      // Matches: '@/utils/counter', '@/store/ui-state', etc.
      //
      // These are user JS utilities that must behave as singletons — all
      // components on a page must share the SAME module instance (same reactive
      // state, same store). If esbuild inlined them, each component bundle would
      // get its own copy and reactive state would not propagate across components.
      //
      // Solution: mark as external and rewrite to the browser-accessible URL
      // /_vexjs/user/<path>.js. The dev server serves those files on-the-fly with
      // import rewriting; the static build pre-copies them to dist/_vexjs/user/.
      // The browser's ES module cache ensures a single instance is shared.
      build.onResolve({ filter: /^@\// }, (args) => {
        let mod = args.path.slice(2); // strip leading @/
        if (!path.extname(mod)) mod += ".js";
        return { path: `/_vexjs/user/${mod}`, external: true };
      });

      // ── Category 3: relative imports (./ and ../) ─────────────────────────
      // Matches: './helpers', '../utils/format', etc.
      //
      // User JS files imported relatively are also served as singleton modules
      // at /_vexjs/user/<resolved-path>.js. This mirrors Vue + Vite: every source
      // file gets its own URL, and the browser module cache ensures the same file
      // is always the same instance regardless of how it was imported.
      //
      // Files outside SRC_DIR (e.g. node_modules reached via ../../) fall through
      // to esbuild's default resolver and are bundled inline as usual.
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        let resolved = path.resolve(args.resolveDir, args.path);
        if (!path.extname(resolved)) resolved += ".js";

        // Only intercept .js user files — anything else (CSS, JSON, non-user) falls through
        if (!resolved.endsWith(".js")) return;
        if (!resolved.startsWith(SRC_DIR) && !resolved.startsWith(PROJECT_ROOT)) return;

        const rel = path.relative(SRC_DIR, resolved).replace(/\\/g, "/");
        return { path: `/_vexjs/user/${rel}`, external: true };
      });
    },
  };
}
