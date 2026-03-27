import fs from "fs/promises";
import path from "path";
import { build } from "./utils/component-processor.js";
import {
  initializeDirectories,
  CLIENT_DIR,
  SRC_DIR,
  PROJECT_ROOT,
  getRootTemplate,
  WATCH_IGNORE,
  generateComponentId,
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
  `<script type="module" src="/_vexjs/services/index.js"></script>`,
  `<script src="/_vexjs/services/hydrate-client-components.js"></script>`,
  `<script src="/_vexjs/services/hydrate.js" id="hydrate-script"></script>`,
].join("\n  ");

shell = shell.replace("</head>", `  ${frameworkScripts}\n</head>`);
await fs.writeFile(path.join(DIST_DIR, "index.html"), shell, "utf-8");

// Step 4: Copy framework client files → dist/_vexjs/
console.log("📦 Copying framework client files...");
await fs.cp(CLIENT_DIR, path.join(DIST_DIR, "_vexjs"), { recursive: true });

// Step 5: Copy generated component bundles → dist/_vexjs/_components/
console.log("📦 Copying component bundles...");
await fs.cp(
  path.join(GENERATED_DIR, "_components"),
  path.join(DIST_DIR, "_vexjs", "_components"),
  { recursive: true }
);

// Step 6: Copy generated services (includes _routes.js) → dist/_vexjs/services/
// This overwrites the framework-level services dir copy with the generated routes
console.log("📦 Copying generated services...");
await fs.cp(
  path.join(GENERATED_DIR, "services"),
  path.join(DIST_DIR, "_vexjs", "services"),
  { recursive: true }
);

// Step 7: Copy user JS files with import rewriting → dist/_vexjs/user/
console.log("📦 Processing user JS files...");
await copyUserJsFiles(SRC_DIR, path.join(DIST_DIR, "_vexjs", "user"));

// Step 8: Copy public/ → dist/ (static assets, CSS)
console.log("📦 Copying public assets...");
const publicDir = path.join(PROJECT_ROOT, "public");
try {
  await fs.cp(publicDir, DIST_DIR, { recursive: true });
} catch {
  // no public/ directory — that's fine
}

// Step 9: Copy pre-rendered HTML for SSG routes (revalidate: 'never')
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

// Step 10: Report SSR-only routes that were skipped
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively walks SRC_DIR, rewrites imports in every .js file,
 * and writes results to destDir preserving the relative path structure.
 *
 * Skips directories listed in WATCH_IGNORE (node_modules, dist, .vexjs, etc.).
 *
 * @param {string} srcDir  Absolute path to user source root (SRC_DIR)
 * @param {string} destDir Absolute path to dist/_vexjs/user/
 */
async function copyUserJsFiles(srcDir, destDir) {
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (WATCH_IGNORE.has(entry.name)) continue;

    const fullSrc = path.join(srcDir, entry.name);
    const relToSrcDir = path.relative(SRC_DIR, fullSrc).replace(/\\/g, "/");
    const fullDest = path.join(destDir, relToSrcDir);

    if (entry.isDirectory()) {
      await copyUserJsFiles(fullSrc, destDir);
    } else if (entry.name.endsWith(".js")) {
      let content;
      try {
        content = await fs.readFile(fullSrc, "utf-8");
      } catch {
        continue;
      }

      content = rewriteUserImports(content, fullSrc, srcDir);

      await fs.mkdir(path.dirname(fullDest), { recursive: true });
      await fs.writeFile(fullDest, content, "utf-8");
    }
  }
}

/**
 * Rewrites import paths in a user JS file so they work in the browser.
 * Mirrors the runtime rewriting done by the /_vexjs/user/* Express handler.
 *
 * - `vex/` and `.app/` → `/_vexjs/services/`
 * - `@/` (project alias) → `/_vexjs/user/`
 * - relative `./` or `../` → `/_vexjs/user/`
 * - external bare specifiers (e.g. npm packages) → left as-is
 *
 * @param {string} content  File source
 * @param {string} filePath Absolute path of the file being rewritten
 * @param {string} srcDir   Absolute SRC_DIR root
 * @returns {string} Rewritten source
 */
function rewriteUserImports(content, filePath, srcDir) {
  return content.replace(
    /^(\s*import\s+[^'"]*from\s+)['"]([^'"]+)['"]/gm,
    (match, prefix, modulePath) => {
      if (modulePath.startsWith("vex/") || modulePath.startsWith(".app/")) {
        let mod = modulePath.replace(/^vex\//, "").replace(/^\.app\//, "");
        if (!path.extname(mod)) mod += ".js";
        return `${prefix}'/_vexjs/services/${mod}'`;
      }
      if (modulePath.startsWith("@/") || modulePath === "@") {
        let resolved = path.resolve(srcDir, modulePath.replace(/^@\//, "").replace(/^@$/, ""));
        if (!path.extname(resolved)) resolved += ".js";
        const rel = path.relative(srcDir, resolved).replace(/\\/g, "/");
        return `${prefix}'/_vexjs/user/${rel}'`;
      }
      if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
        const fileDir = path.dirname(filePath);
        let resolved = path.resolve(fileDir, modulePath);
        if (!path.extname(resolved)) resolved += ".js";
        const rel = path.relative(srcDir, resolved).replace(/\\/g, "/");
        return `${prefix}'/_vexjs/user/${rel}'`;
      }
      return match;
    }
  );
}
