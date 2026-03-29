# @cfdez11/vex

[![npm](https://img.shields.io/npm/v/@cfdez11/vex)](https://www.npmjs.com/package/@cfdez11/vex)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000)](#)
[![Node.js](https://img.shields.io/badge/Node.js-6DA55F?logo=node.js&logoColor=white)](#)

A vanilla JavaScript meta-framework built on Express.js with file-based routing, multiple rendering strategies (SSR, CSR, SSG, ISR), streaming Suspense, and a Vue-like reactive system — no TypeScript, no bundler.

Requires **Node.js >= 18**.

## Installation

```bash
npm install @cfdez11/vex
```

## Quick Start

```bash
mkdir my-app && cd my-app
npm init -y
npm install @cfdez11/vex
npm install -D tailwindcss npm-run-all
```

Update `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev":     "run-p dev:*",
    "dev:app": "vex dev",
    "dev:css": "npx @tailwindcss/cli -i ./src/input.css -o ./public/styles.css --watch",
    "build":   "vex build",
    "start":   "vex start"
  }
}
```

Create the minimum structure:

```bash
mkdir -p pages src public
echo '@import "tailwindcss";' > src/input.css
npm run dev
# → http://localhost:3001
```

## Documentation

- [Routing & Project Structure](docs/routing.md)
- [Components & Layouts](docs/components.md)
- [Rendering Strategies](docs/rendering.md)
- [Reactive System](docs/reactivity.md)
- [Template Syntax](docs/templates.md)
- [Configuration & API](docs/configuration.md)
- [Deploy to Vercel](DEPLOY.md)

## Roadmap

- [x] File-based routing with dynamic segments
- [x] SSR / CSR / SSG / ISR rendering strategies
- [x] Incremental Static Regeneration with background revalidation
- [x] Static path pre-generation (`getStaticPaths`)
- [x] Auto-generated server and client route registries
- [x] Streaming Suspense with fallback UI
- [x] Vue-like reactive system (`reactive`, `computed`, `effect`, `watch`)
- [x] Nested layouts per route
- [x] SPA client-side navigation
- [x] Prefetching with IntersectionObserver
- [x] Server-side data caching (`withCache`)
- [x] HMR (hot reload) in development
- [x] Component props (`xprops`)
- [x] `vex/` import prefix for framework utilities
- [x] `vex.config.json` — configurable `srcDir` and `watchIgnore`
- [x] Published to npm as `@cfdez11/vex`
- [x] VS Code extension with syntax highlighting and go-to-definition
- [ ] Refactor client component prop pipeline
- [ ] esbuild minification for production builds
- [ ] esbuild source maps in dev mode
- [ ] esbuild browser target config
- [ ] esbuild code splitting for shared dependencies
- [ ] Devtools
- [ ] TypeScript support (framework + user code)
- [ ] Improved VS Code extension
- [ ] Theme syntax
- [ ] Docs page
- [ ] Authentication middleware
- [ ] CDN cache integration
- [ ] Fix Suspense marker replacement with multi-root templates
