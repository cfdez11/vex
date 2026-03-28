import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { build } from "./utils/component-processor.js";
import {
  initializeDirectories,
  CLIENT_DIR,
  PROJECT_ROOT,
  getRootTemplate,
  generateComponentId,
  USER_GENERATED_DIR,
} from "./utils/files.js";

const GENERATED_DIR = path.join(PROJECT_ROOT, ".vexjs");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

console.log("🔨 Starting static build...");

// Step 1: Prebuild (components + routes)
console.log("📁 Initializing directories...");
await initializeDirectories();

console.log("⚙️  Generating components and routes...");
const { serverRoutes } = await build();

// Step 2: Create dist/ structure (clean start)
console.log("🗂️  Creating dist/ structure...");
await fs.rm(DIST_DIR, { recursive: true, force: true });
await fs.mkdir(path.join(DIST_DIR, "_vexjs", "_components"), { recursive: true });
await fs.mkdir(path.join(DIST_DIR, "_vexjs", "user"), { recursive: true });

// Step 3: Generate dist/index.html shell
console.log("📄 Generating index.html shell...");
const rootTemplate = await getRootTemplate();
let shell = rootTemplate
  .replace(/\{\{metadata\.title\}\}/g, "App")
  .replace(/\{\{metadata\.description\}\}/g, "")
  .replace(/\{\{props\.children\}\}/g, "");

const frameworkScripts = [
  `<style>vex-root { display: contents; }</style>`,
  `<script type="module" src="/_vexjs/services/index.js"></script>`,
  `<script src="/_vexjs/services/hydrate-client-components.js"></script>`,
  `<script src="/_vexjs/services/hydrate.js" id="hydrate-script"></script>`,
].join("\n  ");

shell = shell.replace("</head>", `  ${frameworkScripts}\n</head>`);
await fs.writeFile(path.join(DIST_DIR, "index.html"), shell, "utf-8");

// Step 4: Copy static framework assets (favicon.ico, app.webmanifest) → dist/_vexjs/
// JS runtime files live in .vexjs/services/ (copied in step 5) — no need to
// copy CLIENT_DIR/services/ separately.
console.log("📦 Copying framework assets...");
for (const asset of ["favicon.ico", "app.webmanifest"]) {
  try {
    await fs.copyFile(
      path.join(CLIENT_DIR, asset),
      path.join(DIST_DIR, "_vexjs", asset)
    );
  } catch {
    // asset not present — skip
  }
}

// Step 5: Copy generated services → dist/_vexjs/services/
// .vexjs/services/ already contains both framework JS (copied by initializeDirectories)
// and generated files (_routes.js). One copy covers everything.
console.log("📦 Copying services...");
await fs.cp(
  path.join(GENERATED_DIR, "services"),
  path.join(DIST_DIR, "_vexjs", "services"),
  { recursive: true }
);

// Step 6: Copy generated component bundles → dist/_vexjs/_components/
console.log("📦 Copying component bundles...");
await fs.cp(
  path.join(GENERATED_DIR, "_components"),
  path.join(DIST_DIR, "_vexjs", "_components"),
  { recursive: true }
);

// Step 7: Copy pre-bundled user JS files → dist/_vexjs/user/
// build() already ran esbuild on every user .js file → USER_GENERATED_DIR.
// npm packages are bundled inline; vex/*, @/*, relative imports stay external.
console.log("📦 Copying pre-bundled user JS files...");
try {
  await fs.cp(USER_GENERATED_DIR, path.join(DIST_DIR, "_vexjs", "user"), { recursive: true });
} catch {
  // no user JS files — that's fine
}

// Step 8: Copy public/ → dist/
console.log("📦 Copying public assets...");
const publicDir = path.join(PROJECT_ROOT, "public");
try {
  await fs.cp(publicDir, DIST_DIR, { recursive: true });
} catch {
  // no public/ directory — that's fine
}

// Step 9: Copy pre-rendered SSG pages
const CACHE_DIR = path.join(GENERATED_DIR, "_cache");
const ssgRoutes = serverRoutes.filter(
  (r) => r.meta.revalidate === "never" || r.meta.revalidate === false
);
if (ssgRoutes.length > 0) {
  console.log("📄 Copying pre-rendered SSG pages...");
  for (const route of ssgRoutes) {
    const cacheFile = path.join(CACHE_DIR, `${generateComponentId(route.serverPath)}.html`);
    try {
      const html = await fs.readFile(cacheFile, "utf-8");
      const routeSegment = route.serverPath === "/" ? "" : route.serverPath;
      const destPath = path.join(DIST_DIR, routeSegment, "index.html");
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, html, "utf-8");
      console.log(`   ✓ ${route.serverPath}`);
    } catch {
      console.warn(`   ✗ ${route.serverPath} (no cached HTML found)`);
    }
  }
}

// Step 10: Report SSR-only routes (skipped in static build)
const ssrOnlyRoutes = serverRoutes.filter((r) => r.meta.ssr);
if (ssrOnlyRoutes.length > 0) {
  console.warn("\n⚠️  The following routes require a server and were NOT included in the static build:");
  for (const r of ssrOnlyRoutes) {
    console.warn(`   ${r.path} (SSR)`);
  }
  console.warn("   These routes will show a 404 in the static build.\n");
}

console.log("✅ Static build complete! Output: dist/");
console.log("\nTo serve locally:  npx serve dist");
console.log("Static host note:  configure your host to serve dist/index.html for all 404s (SPA fallback).");


