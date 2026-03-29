# Deploying a vex app to Vercel

## 1. Create `server.js` in the project root

Vercel needs a file that exports the Express app as default. Create `server.js` in the root of your project:

```js
import express from "express";
import app from "@cfdez11/vex";

void express; // keeps the import explicit for Vercel's detection

export default app;
```

> **Note:** Add `server.js` to `watchIgnore` in `vex.config.json` so the build pipeline does not attempt to bundle it as a client utility (it imports Node built-ins and would fail esbuild's browser-platform pass):
>
> ```json
> {
>   "watchIgnore": ["server.js"]
> }
> ```

## 2. Create `api/index.js`

Vercel only recognises serverless functions inside the `api/` directory. Create `api/index.js` that re-exports from `server.js`:

```js
export { default } from "../server.js";
```

## 3. Add `.npmrc`

pnpm uses symlinks in `node_modules` by default. Vercel does not follow those symlinks when bundling the function, so `express` and other packages are not found at runtime. Add `.npmrc` to the project root to force a flat install:

```
node-linker=hoisted
```

## 4. Create `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm build:css && pnpm build",
  "functions": {
    "api/index.js": {
      "includeFiles": "{root.html,pages/**,components/**,.vexjs/**,public/**,vex.config.json}"
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index.js" }]
}
```

### Why each field

| Field | Reason |
|---|---|
| `installCommand` | Uses pnpm with a locked lockfile for reproducible installs |
| `buildCommand` | Generates Tailwind CSS and runs the vex prebuild (route registry + client bundles) |
| `functions.includeFiles` | Vercel only auto-bundles JS files — the framework also needs `root.html`, page templates, build output (`.vexjs/`), static assets, and the vex config at runtime. Must use brace expansion syntax `{a,b/**}` — comma-separated strings are not valid |
| `rewrites` | Routes every request to the Express function; without this Vercel returns 404 for all paths |

> **Custom `srcDir`:** If `vex.config.json` sets a `srcDir` (e.g. `"srcDir": "app"`), update `includeFiles` to match:
> ```json
> "includeFiles": "{root.html,app/pages/**,app/components/**,.vexjs/**,public/**,vex.config.json}"
> ```
> `root.html` always stays at the project root regardless of `srcDir`.
