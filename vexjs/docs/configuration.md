# Configuration & API

## `vex.config.json`

Optional file at the project root.

```json
{
  "srcDir": "app",
  "watchIgnore": ["dist", "coverage"]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `srcDir` | `string` | `"."` | Directory containing `pages/`, `components/` and all user `.vex` files |
| `watchIgnore` | `string[]` | `[]` | Additional paths to exclude from the dev file watcher. Supports directory names and glob patterns (`"utils/legacy.js"`, `"components/wip/**"`). Merged with built-in defaults: `node_modules`, `dist`, `build`, `.git`, `.vexjs`, `coverage`, `.next`, `.nuxt`, `tmp`, and more |

## CLI scripts

```bash
vex dev     # Start dev server with HMR (--watch)
vex build   # Pre-render pages, generate routes, bundle client JS
vex start   # Production server (requires a prior build)
```

> `vex start` requires `vex build` to have been run first.

## Server script hooks

| Export | Description |
|--------|-------------|
| `async getData({ req, props })` | Fetches data; return value is merged into template scope |
| `metadata` / `async getMetadata({ req, props })` | Page-level config (`title`, `description`, `static`, `revalidate`) |
| `async getStaticPaths()` | Returns `[{ params }]` for pre-rendering dynamic routes |

## Import conventions

| Pattern | Example | Behaviour |
|---------|---------|-----------|
| `vex/*` | `import { reactive } from "vex/reactive"` | Framework singleton — shared instance across all components |
| `@/*` | `import store from "@/utils/store.js"` | Project alias for your source root — also a singleton |
| `./` / `../` | `import { fn } from "./helpers.js"` | Relative user file — also a singleton |
| npm bare specifier | `import { format } from "date-fns"` | Bundled inline by esbuild |

All user JS files (`@/` and relative) are pre-bundled at startup: npm packages are inlined, while `vex/*`, `@/*`, and relative imports stay external. The browser's ES module cache guarantees every import of the same file returns the same instance — enabling shared reactive state across components without a dedicated store library.

## Client script imports

| Import | Description |
|--------|-------------|
| `vex/reactive` | Reactivity engine (`reactive`, `computed`, `effect`, `watch`) |
| `vex/navigation` | Router utilities (`useRouteParams`, `useQueryParams`) |

## Styling

The framework uses **Tailwind CSS v4**. The dev script watches `src/input.css` and outputs to `public/styles.css`.

```css
/* src/input.css */
@import "tailwindcss";
```

Reference the stylesheet in `root.html`:

```html
<link rel="stylesheet" href="/styles.css">
```
