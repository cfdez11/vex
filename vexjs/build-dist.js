/**
 * build-dist.js — npm package build script for @cfdez11/vex
 *
 * PURPOSE:
 *   Builds the publishable dist/ folder from the framework source files.
 *   This is NOT related to building a user's app — it only processes the
 *   framework's own server/, client/, and bin/ directories.
 *
 *   Runs automatically via the "prepublishOnly" npm hook before every
 *   `npm publish`. Can also be run manually: `node build-dist.js`
 *
 * WHAT IT DOES:
 *   1. Cleans dist/ to ensure a fresh build with no stale files.
 *   2. Transforms all server + bin JS files with esbuild (Node platform).
 *   3. Transforms all client JS files with esbuild (browser platform).
 *      Two separate passes are needed because platform affects how esbuild
 *      handles globals (process, window, etc.) during syntax optimisation.
 *   4. Restores the shebang line in bin/vex.js — esbuild strips it during
 *      transformation, so we prepend #!/usr/bin/env node back manually.
 *   5. Copies non-JS assets (root.html, app.webmanifest) as-is.
 *      favicon.ico is intentionally excluded — users supply their own in public/.
 *
 * ESBUILD OPTIONS:
 *   bundle: false          — each file is transformed individually, imports
 *                            are left as-is. The dist/ structure mirrors source.
 *   minifyWhitespace: true — removes spaces, newlines, and all comments
 *                            (including JSDoc) from the output.
 *   minifySyntax: true     — simplifies expressions and removes dead code.
 *   minifyIdentifiers:false— export and function names are preserved so that
 *                            named imports and stack traces keep working.
 *   legalComments: "none"  — strips any remaining license-style comments (/ *! *\/).
 *
 * EXCLUDED FILES:
 *   favicon.ico — placeholder asset, users provide their own.
 *
 * SOURCE IS NEVER MODIFIED:
 *   server/, client/, and bin/ always retain the full commented source.
 *   dist/ is in .gitignore and is only created at publish time.
 */

import esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");

// Files excluded from the dist build.
const EXCLUDE_FILES = new Set([]);
const EXCLUDE_ASSETS = new Set(["favicon.ico"]);

// Recursively collects all .js files under a directory, skipping EXCLUDE_FILES.
async function collectJs(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...(await collectJs(full)));
    else if (e.name.endsWith(".js") && !EXCLUDE_FILES.has(e.name))
      results.push(full);
  }
  return results;
}

// Shared esbuild config for both passes.
// outbase: ROOT ensures dist/ mirrors the source structure exactly:
//   server/utils/files.js → dist/server/utils/files.js
const shared = {
  bundle: false,
  outbase: ROOT,
  outdir: DIST,
  format: "esm",
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: "none",
  logLevel: "silent",
};

// Step 1: Clean dist/ — prevents stale files from previous builds.
console.log("🧹 Cleaning dist/...");
await fs.rm(DIST, { recursive: true, force: true });

// Step 2: Transform server + bin files (Node.js platform).
// minifyIdentifiers is disabled here to preserve readable function names
// in stack traces, which developers see when the framework throws errors.
console.log("⚙️  Building server + bin...");
const serverFiles = await collectJs(path.join(ROOT, "server"));
const binFiles = await collectJs(path.join(ROOT, "bin"));
await esbuild.build({
  ...shared,
  entryPoints: [...serverFiles, ...binFiles],
  platform: "node",
  minifyIdentifiers: false,
});

// Step 3: Transform client files (browser platform).
// minifyIdentifiers is enabled here — these files are served to end-user
// browsers where stack traces are irrelevant, so full minification is safe.
// ESM exports are preserved by esbuild regardless of this flag.
console.log("⚙️  Building client...");
const clientFiles = await collectJs(path.join(ROOT, "client"));
await esbuild.build({
  ...shared,
  entryPoints: clientFiles,
  platform: "browser",
  minifyIdentifiers: true,
});

// Step 4: Restore shebang in bin/vex.js.
// esbuild strips the #!/usr/bin/env node line during transformation.
// Without it, `vex dev` would fail with a syntax error when executed directly.
console.log("📋 Restoring shebang in bin/vex.js...");
const binOut = path.join(DIST, "bin", "vex.js");
const binContent = await fs.readFile(binOut, "utf-8");
if (!binContent.startsWith("#!/usr/bin/env node")) {
  await fs.writeFile(binOut, "#!/usr/bin/env node\n" + binContent);
}

// Step 5: Copy non-JS assets.
// root.html is the default HTML shell template used when the user has no root.html.
// app.webmanifest is the default PWA manifest.
// favicon.ico is intentionally excluded — users supply their own in public/.
console.log("📁 Copying static assets...");
await fs.copyFile(
  path.join(ROOT, "server", "root.html"),
  path.join(DIST, "server", "root.html")
);

const clientAssets = await fs.readdir(path.join(ROOT, "client"), {
  withFileTypes: true,
});
for (const e of clientAssets) {
  if (e.isFile() && !EXCLUDE_ASSETS.has(e.name)) {
    await fs.copyFile(
      path.join(ROOT, "client", e.name),
      path.join(DIST, "client", e.name)
    );
  }
}

console.log("✅ Build complete → dist/");
