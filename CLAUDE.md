# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server + Tailwind watcher (use this for development)
pnpm dev:server   # Node.js server only with --watch
pnpm dev:css      # Tailwind CSS watcher only
pnpm build        # Prebuild (generate routes/components) + minify CSS
pnpm start        # Run production server on port 3000
```

The `build` script runs `prebuild.js` which auto-generates client component bundles and route registries. Run this after adding new pages or components.

**Linting/Formatting:** Biome is configured via `biome.json`.
```bash
pnpm biome check .         # Lint
pnpm biome check --write . # Lint + auto-fix
```

There are no tests.

## Architecture

This is a **custom meta-framework** built on Express.js that provides file-based routing, multiple rendering strategies, and a Vue-like reactive system — all in vanilla JavaScript.

### Pages & Routing

Pages live in `pages/` with file-based routing:
- `pages/page.html` → `/`
- `pages/about/page.html` → `/about`
- `pages/users/[id]/page.html` → `/users/:id` (dynamic segments)
- `pages/layout.html` → wraps all pages (root layout)
- `pages/not-found/page.html` → 404 handler
- `pages/error/page.html` → error handler

### Component File Structure

Every `.html` component has three optional sections:

```html
<script server>
  // Runs on the server per-request. Can use Node APIs, async/await, imports.
  const metadata = { title: "Page Title" };
  async function getData({ req, props }) {
    // req: Express request (req.params for dynamic routes)
    // props: attributes passed to this component from a parent template
    return { user: await fetchUser(req.params.id) };
  }
</script>

<script client>
  // Bundled and sent to the browser. Uses the reactive system.
  import { reactive, computed, effect, watch } from ".app/reactive.js";
  const count = reactive(0);
</script>

<template>
  <!-- VexJS template syntax: {{expr}}, x-if, x-for, x-show, :prop, @event -->
  <h1>{{title}}</h1>
  <button @click="count.value++">{{count.value}}</button>
</template>
```

**Server script conventions:**
- `getData({ req, props })` — async function; its return value is merged into the template scope
- `metadata` — plain object (or `getMetadata({ req, props })` async function) with page-level config
- `getStaticPaths()` — async function returning `[{ params: {...} }]` for pre-rendering dynamic routes
- `@event` handlers and `x-on:` attributes are stripped server-side; they only work in the client script

**Component props (`xprops`):**

Components that accept props from parents declare them with `xprops()`:

```javascript
// Inside <script server> or <script client>
const props = xprops({
  userId: { default: null },
  start: { default: 10 },
});
```

Parent templates pass props as attributes: `<UserCard :userId="user.id" />`

### Rendering Strategies

Set via `metadata` in the server script:

| Strategy | Config | Behavior |
|----------|--------|----------|
| SSR | default | Rendered fresh on each request |
| SSG | `metadata.static = true` | Rendered once, cached indefinitely |
| ISR | `metadata.revalidate = 10` | Cached, revalidated every N seconds |
| CSR | Page has only `<script client>` | Client fetches its own data |

`revalidate` accepts: a number (seconds), `true` (60s), `0` (always stale but serve cache while regenerating), or `false`/`"never"` (never stale). Cache is stored in `.app/server/_cache/`. Manual invalidation: `POST /revalidate?path=/route`.

### Server Components & Suspense

Components can be embedded in templates. Slow components can be wrapped in `<Suspense>`:

```html
<Suspense :fallback="<UserCardSkeleton />">
  <UserCardDelayed :userId="1" />
</Suspense>
```

The server sends the skeleton immediately, then streams the real content when ready.

### Client-Side Reactivity

The reactive system (`.app/client/services/reactive.js`) mirrors Vue's Composition API:
- `reactive(value)` — wraps primitives in `{ value }` proxy; objects become deep reactive proxies
- `computed(() => expr)` — auto-tracked computed value; access via `.value`
- `effect(() => ...)` — runs immediately on creation, re-runs whenever dependencies change
- `watch(() => dep, (newVal) => ...)` — explicit watcher; does NOT run on creation by default

**Critical distinction:** primitives need `.value`, objects do not:
```javascript
const count = reactive(0);   count.value++        // primitive → use .value
const state = reactive({x: 1}); state.x++         // object → direct access
```

Client-side route params: `useRouteParams()` from `.app/navigation/index.js` returns a reactive object updated on navigation.

### Framework Internals (`.app/`)

The `.app/` directory contains the framework runtime — generally don't edit these unless modifying framework behavior:

- `.app/server/prebuild.js` — generates `_routes.js` and bundles client scripts from `.html` files
- `.app/server/utils/component-processor.js` — parses `.html` files into server/client/template sections
- `.app/server/utils/template.js` — compiles Vue-like template syntax to HTML strings
- `.app/server/utils/router.js` — SSR rendering pipeline, streaming, ISR cache logic
- `.app/server/utils/streaming.js` — Suspense boundary extraction and chunked streaming
- `.app/client/services/reactive.js` — proxy-based reactivity engine
- `.app/client/services/navigation/` — SPA router, link interception, history API

Auto-generated files (overwritten by `pnpm build`):
- `.app/server/_routes.js` — server route registry
- `.app/client/services/_routes.js` — client route registry
- `.app/client/_components/` — bundled client-side JS per component

### Navigation Flow

Client-side navigation intercepts link clicks, matches routes, and either:
- **SSR routes**: fetches fresh HTML from server, re-renders
- **CSR routes**: loads cached client module, renders client-side

The layout (`pages/layout.html`) persists across navigations; only the page content is swapped. Add `data-prefetch` to `<a>` tags to prefetch on hover. Programmatic navigation: `window.app.navigate('/path')`.

### Template Expression Scope

Template expressions (`{{expr}}`, `x-if`, `:prop`, etc.) are evaluated against the object returned by `getData()` merged with `metadata`. Expressions support property access (`user.name`), array indexing (`items[0]`), and method calls (`name.toUpperCase()`). Complex logic should go in `getData` rather than inline expressions — ternaries and filters are not supported.
