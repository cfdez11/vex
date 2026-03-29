import fs from "fs/promises";
import { watch, existsSync, statSync, readFileSync } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import esbuild from "esbuild";

/**
 * Absolute path of the current file.
 * Used to resolve project root in ESM context.
 * @private
 */
const __filename = fileURLToPath(import.meta.url);
/**
 * Directory name of the current module.
 * @private
 */
const __dirname = path.dirname(__filename);
// Framework's own directory (packages/vexjs/ — 3 levels up from server/utils/)
const FRAMEWORK_DIR = path.resolve(__dirname, "..", "..");
// User's project root (where they run the server)
export const PROJECT_ROOT = process.cwd();
const ROOT_DIR = PROJECT_ROOT;

/**
 * User configuration loaded from `vex.config.json` at the project root.
 *
 * Supported fields:
 *   - `srcDir`      {string}   Subfolder that contains pages/, components/ and
 *                              all user .vex code. Defaults to "." (project root).
 *                              Example: "app"  →  pages live at app/pages/
 *   - `watchIgnore` {string[]} Additional directory names to exclude from the
 *                              dev file watcher, merged with the built-in list.
 *                              Example: ["dist", "coverage"]
 *
 * The file is optional — if absent, all values fall back to their defaults.
 */
let _vexConfig = {};
try {
  _vexConfig = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "vex.config.json"), "utf-8"));
} catch {}

/**
 * Absolute path to the directory that contains the user's source files
 * (pages/, components/, and any other .vex folders).
 *
 * Derived from `srcDir` in vex.config.json, resolved relative to PROJECT_ROOT.
 * Defaults to PROJECT_ROOT when `srcDir` is not set.
 *
 * Changing this allows users to organise all their app code in a single
 * subfolder (e.g. `app/`) so the dev watcher only needs to observe that
 * folder instead of the entire project root.
 */
export const SRC_DIR = path.resolve(PROJECT_ROOT, _vexConfig.srcDir || ".");

/**
 * Set of directory *names* (not paths) that the dev file watcher will skip
 * when scanning for .vex changes.
 *
 * The check is applied to every segment of the changed file's relative path,
 * so a directory named "dist" is ignored regardless of nesting depth.
 *
 * Built-in ignored directories (always excluded):
 *   - Build outputs:        dist, build, out, .output
 *   - Framework generated:  .vexjs, public
 *   - Dependencies:         node_modules
 *   - Version control:      .git, .svn
 *   - Test coverage:        coverage, .nyc_output
 *   - Other fw caches:      .next, .nuxt, .svelte-kit, .astro
 *   - Misc:                 tmp, temp, .cache, .claude
 *
 * Extended via `watchIgnore` in vex.config.json.
 */
export const WATCH_IGNORE = new Set([
  // build outputs
  "dist", "build", "out", ".output",
  // framework generated
  ".vexjs", "public",
  // dependencies
  "node_modules",
  // vcs
  ".git", ".svn",
  // test coverage
  "coverage", ".nyc_output",
  // other framework caches
  ".next", ".nuxt", ".svelte-kit", ".astro",
  // misc
  "tmp", "temp", ".cache", ".claude",
  // user-defined extras from vex.config.json.
  // Simple names (no /, *, .) are treated as directory names here.
  ...(_vexConfig.watchIgnore || []).filter(p => !/[\/\*\.]/.test(p)),
]);

/**
 * Glob patterns derived from `watchIgnore` entries in vex.config.json that
 * contain path separators, wildcards, or dots — i.e. file-level patterns.
 *
 * Simple directory names in the same array go to WATCH_IGNORE instead.
 *
 *   "watchIgnore": ["utils/legacy.js", "components/wip/**", "wip"]
 *   → "wip"               added to WATCH_IGNORE  (directory name)
 *   → "utils/legacy.js"   added to WATCH_IGNORE_FILES (glob pattern)
 *   → "components/wip/**" added to WATCH_IGNORE_FILES (glob pattern)
 *
 * Default entries cover common server entry-point filenames that should never
 * be bundled as client utilities (they import Node built-ins and would fail
 * esbuild's browser-platform pass).
 */
export const WATCH_IGNORE_FILES = [
  "server.js",
  ...(_vexConfig.watchIgnore || []).filter(p => /[\/\*\.]/.test(p)),
];

export const PAGES_DIR = path.resolve(SRC_DIR, "pages");
export const SERVER_APP_DIR = path.join(FRAMEWORK_DIR, "server");
export const CLIENT_DIR = path.join(FRAMEWORK_DIR, "client");
export const CLIENT_SERVICES_DIR = path.join(CLIENT_DIR, "services");
// Generated files go to PROJECT_ROOT/.vexjs/
const GENERATED_DIR = path.join(PROJECT_ROOT, ".vexjs");
const CACHE_DIR = path.join(GENERATED_DIR, "_cache");
export const CLIENT_COMPONENTS_DIR = path.join(GENERATED_DIR, "_components");
export const USER_GENERATED_DIR = path.join(GENERATED_DIR, "user");
const ROOT_HTML_USER = path.join(PROJECT_ROOT, "root.html");
const ROOT_HTML_DEFAULT = path.join(FRAMEWORK_DIR, "server", "root.html");
export const ROOT_HTML_DIR = ROOT_HTML_USER;

/**
 * Ensures all required application directories exist.
 *
 * This function initializes:
 * - Client application directory
 * - Server application directory
 * - Server-side HTML cache directory
 *
 * Directories are created recursively and safely if they already exist.
 *
 * @async
 * @private
 * @returns {Promise<boolean|undefined>}
 * Resolves `true` when directories are created successfully.
 */
async function minifyServicesDir(src, dest) {
  const jsFiles = [];
  const otherFiles = [];

  const collect = async (srcDir, destDir) => {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await collect(srcPath, destPath);
      } else if (entry.name.endsWith(".js")) {
        jsFiles.push({ in: srcPath, out: destPath });
      } else {
        otherFiles.push({ src: srcPath, dest: destPath });
      }
    }));
  };

  await collect(src, dest);

  await Promise.all([
    esbuild.build({
      entryPoints: jsFiles.map(f => f.in),
      bundle: false,
      format: "esm",
      platform: "browser",
      minify: true,
      legalComments: "none",
      outdir: dest,
      outbase: src,
      logLevel: "silent",
    }),
    ...otherFiles.map(f => fs.copyFile(f.src, f.dest)),
  ]);
}

export async function initializeDirectories() {
  try {
    const servicesDir = path.join(GENERATED_DIR, "services");
    await Promise.all([
      fs.mkdir(GENERATED_DIR, { recursive: true }),
      fs.mkdir(CACHE_DIR, { recursive: true }),
      fs.mkdir(CLIENT_COMPONENTS_DIR, { recursive: true }),
      fs.mkdir(USER_GENERATED_DIR, { recursive: true }),
      fs.mkdir(servicesDir, { recursive: true }),
    ]);

    // Copy (or minify in production) framework client runtime files into
    // .vexjs/services/ so they are served by the /_vexjs/services static route
    // alongside generated files like _routes.js.
    // Generated files (prefixed with _) are written later by the build step
    // and overwrite any stale copies here.
    if (process.env.NODE_ENV === "production") {
      await minifyServicesDir(CLIENT_SERVICES_DIR, servicesDir);
    } else {
      await fs.cp(CLIENT_SERVICES_DIR, servicesDir, { recursive: true });
    }

    return true;
  } catch (err) {
    console.error("Failed to create cache directory:", err);
  }
}

/**
 * Adjusts a client module path and its corresponding import statement.
 *
 * This function modifies the module path if it resides within the server directory,
 * converting it to the corresponding path in the client services directory. 
 * If the module path is already within the client services directory, it returns it unchanged.
 *
 * @param {string} modulePath - The original module path to adjust.
 * @param {string} importStatement - The import statement string that references the module.
 * @returns {{
 *   path: string,
 *   importStatement: string
 * }}
 * An object containing:
 * - `path`: The adjusted module path suitable for client usage.
 * - `importStatement`: The updated import statement reflecting the adjusted path.
 *
 * @example
 * const result = adjustClientModulePath(
 *   'vex/reactive',
 *   "import { reactive } from 'vex/reactive';"
 * );
 * console.log(result.path); // '/_vexjs/services/reactive.js'
 */
export function adjustClientModulePath(modulePath, importStatement, componentFilePath = null) {
  if (modulePath.startsWith("/_vexjs/")) {
    return { path: modulePath, importStatement };
  }

  // User imports — relative (e.g. "../utils/context") or @ alias (e.g. "@/utils/context")
  // — served via /_vexjs/user/
  const isRelative = (modulePath.startsWith("./") || modulePath.startsWith("../")) && componentFilePath;
  const isAtAlias = modulePath.startsWith("@/") || modulePath === "@";
  if (isRelative || isAtAlias) {
    let resolvedPath;
    if (isAtAlias) {
      resolvedPath = path.resolve(SRC_DIR, modulePath.replace(/^@\//, "").replace(/^@$/, ""));
    } else {
      const componentDir = path.dirname(componentFilePath);
      resolvedPath = path.resolve(componentDir, modulePath);
    }
    if (!path.extname(resolvedPath)) {
      if (existsSync(resolvedPath + ".js")) {
        resolvedPath += ".js";
      } else if (existsSync(path.join(resolvedPath, "index.js"))) {
        resolvedPath = path.join(resolvedPath, "index.js");
      } else {
        resolvedPath += ".js";
      }
    }
    const relativePath = path.relative(SRC_DIR, resolvedPath).replace(/\\/g, "/");
    const adjustedPath = `/_vexjs/user/${relativePath}`;
    const adjustedImportStatement = importStatement.replace(modulePath, adjustedPath);
    return { path: adjustedPath, importStatement: adjustedImportStatement };
  }

  // Framework imports (vex/)
  let relative = modulePath.replace(/^vex\//, "");
  let adjustedPath = `/_vexjs/services/${relative}`;

  // Auto-resolve directory → index.js, bare name → .js
  const fsPath = path.join(CLIENT_SERVICES_DIR, relative);
  if (existsSync(fsPath) && statSync(fsPath).isDirectory()) {
    adjustedPath += "/index.js";
  } else if (!path.extname(adjustedPath)) {
    adjustedPath += ".js";
  }

  const adjustedImportStatement = importStatement.replace(modulePath, adjustedPath);
  return { path: adjustedPath, importStatement: adjustedImportStatement };
}

/**
 * Gets relative path from one directory to another
 * @param {string} from 
 * @param {string} to 
 * @returns {string}
 */
export function getRelativePath(from, to) {
  return path.relative(from, to);
}

/**
 * Gets directory name from a file path
 * @param {string} filePath 
 * @returns {string}
 */
function getDirectoryName(filePath) {
  return path.dirname(filePath);
}

/**
 * Retrieves layout file paths for a given page.
 *
 * Layouts are determined by traversing up the directory tree
 * from the page's location to the pages root, collecting any
 * `layout.html` files found along the way.
 *
 * @async
 * @param {string} pagePath 
 * @returns {Promise<string[]>}
 */
/**
 *
 * `getLayoutPaths` calls `fs.access` on every ancestor directory of `pagePath`
 * to discover which `layout.html` files exist. The result is deterministic for
 * a given page path — the filesystem structure does not change between requests.
 *
 * Key:   absolute page file path
 * Value: array of absolute layout.html paths (innermost → outermost)
 *
 * In production entries live forever (deploy is immutable).
 * In dev the watcher below clears the whole cache whenever any layout.html is
 * created, modified, or deleted, so the next request re-discovers the correct set.
 */
const layoutPathsCache = new Map();

if (process.env.NODE_ENV !== "production") {
  // Watch the entire pages tree. When a layout.html changes, the set of layouts
  // that exist may have changed — evict all cached entries to be safe.
  watch(PAGES_DIR, { recursive: true }, (_, filename) => {
    if (filename === "layout.vex" || filename?.endsWith(`${path.sep}layout.vex`)) {
      layoutPathsCache.clear();
    }
  });
}

async function _getLayoutPaths(pagePath) {
  const layouts = [];
  const relativePath = getRelativePath(PAGES_DIR, pagePath);
  const pathSegments = getDirectoryName(relativePath).split(path.sep);
  
  // Always start with base layout
  const baseLayout = path.join(PAGES_DIR, 'layout.vex');
  if (await fileExists(baseLayout)) {
    layouts.push(baseLayout);
  }
  
  // Add nested layouts based on directory structure
  let currentPath = PAGES_DIR;
  for (const segment of pathSegments) {
    if (segment === '.' || segment === '..') continue;
    
    currentPath = path.join(currentPath, segment);
    const layoutPath = path.join(currentPath, 'layout.vex');
    
    if (await fileExists(layoutPath)) {
      layouts.push(layoutPath);
    }
  }
  
  return layouts;
}

/**
 * Cached wrapper around `_getLayoutPaths`.
 *
 * Returns the cached layout list on repeated calls for the same page, avoiding
 * repeated `fs.access` probes on every SSR request.
 *
 * @param {string} pagePath - Absolute path to the page file.
 * @returns {Promise<string[]>}
 */
export async function getLayoutPaths(pagePath) {
  if (layoutPathsCache.has(pagePath)) return layoutPathsCache.get(pagePath);
  const result = await _getLayoutPaths(pagePath);
  layoutPathsCache.set(pagePath, result);
  return result;
}

/**
 * Normalizes file content before persisting it to disk.
 *
 * - Converts Windows line endings to Unix
 * - Collapses multiple whitespace characters
 * - Trims leading and trailing whitespace
 *
 * Used mainly for generated artifacts (HTML, JS).
 *
 * @param {string} content
 * Raw file content.
 *
 * @returns {string}
 * Normalized content.
 */
function formatFileContent(content) {
  return content
    .trim();
}

/**
 * Writes formatted content to disk.
 *
 * Automatically normalizes content before writing.
 *
 * @async
 * @param {string} filePath
 * Absolute path to the output file.
 *
 * @param {string} content
 * File content to write.
 *
 * @returns {Promise<void>}
 */
export async function writeFile(filePath, content) {
  const formattedContent = formatFileContent(content);
  return fs.writeFile(filePath, formattedContent, 'utf-8');
}

/**
 * Reads a UTF-8 encoded file from disk.
 *
 * @async
 * @param {string} filePath
 * Absolute path to the file.
 *
 * @returns {Promise<string>}
 * File contents.
 */
export function readFile(filePath) {
  return fs.readFile(filePath, 'utf-8');
}


/**
 * Checks whether a file exists and is accessible.
 *
 * @async
 * @param {string} filePath
 * Absolute path to the file.
 *
 * @returns {Promise<boolean>}
 * True if the file exists, false otherwise.
 */
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a stable, filesystem-safe component identifier
 * from a relative component path.
 *
 * This name is used to:
 * - Create client-side JS module filenames
 * - Reference client components during hydration
 *
 * @param {string} componentPath
 * Relative path to the component from project root.
 *
 * @returns {string}
 * Autogenerated component name prefixed with `_`.
 */
function getAutogeneratedComponentName(componentPath) {
  const componentName = componentPath
    .replace(ROOT_DIR + path.sep, '')
    .split(path.sep)
    .filter(Boolean)
    .join('_')
    .replaceAll('.vex', '')
    .replaceAll(path.sep, '_')
    .replaceAll('-', '_')
    .replaceAll(':', '');

  return `_${componentName}`;
}

/**
 * Generates a unique and deterministic ID for a component or page path.
 *
 * This is useful for naming client component chunks, cached HTML files, or
 * any scenario where a stable, filesystem-safe identifier is needed.
 * 
 * The generated ID combines a sanitized base name with a fixed-length SHA-256 hash
 * derived from the relative component path, ensuring uniqueness even across
 * similarly named components in different directories.
 *
 * @param {string} componentPath - Absolute or project-root-relative path of the component.
 * @param {Object} [options] - Optional configuration.
 * @param {number} [options.length=8] - Number of characters from the hash to include in the ID.
 * @param {boolean} [options.prefix=true] - Whether to include the base component name as a prefix.
 *
 * @returns {string} A deterministic, unique, and filesystem-safe component ID.
 *
 * @example
 * generateComponentId("/src/components/Header.jsx");
 * // "_Header_3f1b2a4c"
 *
 * @example
 * generateComponentId("/src/components/Footer.jsx", { length: 12, prefix: false });
 * // "7a9b1c2d5e6f"
 */
export function generateComponentId(componentPath, options = {}) {
  const { length = 8, prefix = true } = options;

  const relativePath = componentPath.replace(ROOT_DIR + path.sep, '');
  
  const hash = crypto.createHash("sha256").update(relativePath).digest("hex").slice(0, length);

  const baseName = getAutogeneratedComponentName(componentPath).replace(/^_/, '');

  return prefix ? `_${baseName}_${hash}` : hash;
}

/**
 * Resolves the absolute path to a page's main HTML file.
 *
 * @param {string} pageName
 * Page directory name.
 *
 * @returns {string}
 * Absolute path to `page.html`.
 */
export const getPagePath = (pageName) =>
  path.resolve(PAGES_DIR, pageName, "page.vex");

/**
 * Retrieves the root HTML template.
 *
 * @async
 * @returns {Promise<string>}
 * Root HTML content.
 */
export const getRootTemplate = async () => {
  try {
    await fs.access(ROOT_HTML_USER);
    return await fs.readFile(ROOT_HTML_USER, "utf-8");
  } catch {
    return await fs.readFile(ROOT_HTML_DEFAULT, "utf-8");
  }
};

/**
 * Recursively scans a directory and returns all files found.
 *
 * Each file entry includes:
 * - Absolute path
 * - Relative project path
 * - File name
 *
 * @async
 * @param {string} dir
 * Directory to scan.
 *
 * @returns {Promise<Array<{
 *   fullpath: string,
 *   name: string,
 *   path: string
 * }>>}
 */
export async function readDirectoryRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullpath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await readDirectoryRecursive(fullpath));
    } else {
      files.push({
        path: fullpath.replace(ROOT_DIR, ''),
        fullpath,
        name: entry.name,
      });
    }
  }

  return files;
}

/**
 * Derives a component or page name from its filesystem path.
 *
 * Handles:
 * - Pages inside `/pages`
 * - Nested routes
 * - Standalone components
 *
 * @param {string} fullFilepath
 * Absolute file path.
 *
 * @param {string} fileName
 * File name.
 *
 * @returns {string}
 * Derived component name.
 */

export const getComponentNameFromPath = (fullFilepath, fileName) => {
  const filePath = fullFilepath.replace(ROOT_DIR + path.sep, "");
  const isPage = filePath.startsWith(path.join("pages", path.sep));
  if (isPage) {
    const segments = filePath.split(path.sep);
    if (segments.length === 2) {
      return segments[0].replace(".vex", "");
    } else {
      return segments[segments.length - 2].replace(".vex", "");
    }
  }
  return fileName.replace(".vex", "");
};

/**
 * Retrieves cached HTML for a component or page from disk.
 *
 * Supports Incremental Static Regeneration (ISR) by returning cached HTML
 * and its metadata. The `isStale` flag can be used to determine if the HTML
 * should be regenerated.
 *
 * @async
 * @param {Object} options
 * @param {string} options.componentPath - Unique identifier or path of the component/page.
 * @returns {Promise<{
 *   html: string | null,
 *   meta: { generatedAt: number, isStale: boolean } | null
 * }>} 
 *   - `html`: The cached HTML content, or null if it does not exist.
 *   - `meta`: Metadata object containing:
 *       - `generatedAt`: Timestamp (ms) of when the HTML was generated.
 *       - `isStale`: Boolean indicating if the cache has been manually invalidated.
 */
export async function getComponentHtmlDisk({ componentPath }) {
  const filePath = path.join(CACHE_DIR, generateComponentId(componentPath) + ".html");
  const metaPath = filePath + ".meta.json";

  const [existsHtml, existsMeta] = await Promise.all([fileExists(filePath), fileExists(metaPath)]);

  if (!existsMeta || !existsHtml) {
    return { html: null, meta: null };
  }

  const [html, meta] = await Promise.all([
    fs.readFile(filePath, "utf-8"),
    fs.readFile(metaPath, "utf-8")
  ]).then(([htmlContent, metaContent]) => [htmlContent, JSON.parse(metaContent)]);

  return { html, meta };
}

/**
 * Persists server-rendered HTML to disk along with metadata.
 *
 * Metadata includes:
 * - `generatedAt`: timestamp of generation
 * - `isStale`: initially false
 *
 * @async
 * @param {Object} options
 * @param {string} options.componentPath - Unique identifier or path of the component/page.
 * @param {string} options.html - The HTML content to save.
 * @returns {Promise<void>} Resolves when the HTML and metadata have been successfully saved.
 */
export async function saveComponentHtmlDisk({ componentPath, html }) {
  const filePath = path.join(CACHE_DIR, generateComponentId(componentPath) + ".html");
  const metaPath = filePath + ".meta.json";

  const meta = {
    generatedAt: Date.now(),
    isStale: false,
    path: componentPath,
  };

  await Promise.all([
    writeFile(filePath, html, "utf-8"),
    writeFile(metaPath, JSON.stringify(meta), "utf-8"),
  ]);
}

/**
 * Marks a cached component/page as stale without regenerating it.
 *
 * Useful for manual revalidation of ISR pages.
 *
 * @async
 * @param {Object} options
 * @param {string} options.componentPath - Unique identifier or path of the component/page to mark as stale.
 * @returns {Promise<void>} Resolves when the cache metadata has been updated.
 */
export async function markComponentHtmlStale({ componentPath }) {
  const filePath = path.join(CACHE_DIR, generateComponentId(componentPath) + ".html");
  const metaPath = filePath + ".meta.json";


  if (!(await fileExists(metaPath))) return;

  const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
  meta.isStale = true;

  await writeFile(metaPath, JSON.stringify(meta), "utf-8");
}

/**
 * Writes the server-side routes definition file.
 *
 * This file is consumed at runtime by the server router.
 *
 * @async
 * @param {string[]} serverRoutes
 * Serialized server route objects.
 *
 * @returns {Promise<void>}
 */

/**
 * Writes the server-side route registry to `_routes.js`.
 *
 * @param {Array<{
 *   path: string,
 *   serverPath: string,
 *   isNotFound: boolean,
 *   meta: { ssr: boolean, requiresAuth: boolean, revalidate: number | string }
 * }>} serverRoutes - Plain route objects.
 */
export async function saveServerRoutesFile(serverRoutes) {
  await writeFile(
    path.join(GENERATED_DIR, "_routes.js"),
    `// Auto-generated by prebuild — do not edit manually.\nexport const routes = ${JSON.stringify(serverRoutes, null, 2)};\n`
  );
}

/**
 * Writes the client-side routes definition file.
 *
 * Includes:
 * - Route definitions
 *
 * @async
 * @param {string[]} clientRoutes
 * Serialized client route objects.
 * *
 * @returns {Promise<void>}
 */
export async function saveClientRoutesFile(clientRoutes) {
  const commentsClient = `
    /**
     * @typedef {Object} RouteMeta
     * @property {boolean} ssr
     * @property {boolean} requiresAuth
     * @property {number} revalidateSeconds
     */

    /**
     * @typedef {Object} Route
     * @property {string} path
     * @property {string} serverPath
     * @property {boolean} isNotFound
     * @property {(marker: HTMLElement) => Promise<{ render: (marker: string) => void, metadata: any}>} [component]
     * @property {RouteMeta} meta
     * @property {Array<{ name: string, importPath: string }>} [layouts]
     */
  `;
  const clientFileCode = `
    import { loadRouteComponent } from './cache.js';

    ${commentsClient}
    export const routes = [
      ${clientRoutes.join(",\n")}
    ];
  `;

  await writeFile(
    path.join(GENERATED_DIR, "services", "_routes.js"),
    clientFileCode
  );
}

/**
 * Converts a page file path into a public-facing route path.
 *
 * Keeps dynamic segments in `[param]` format.
 *
 * @param {string} filePath
 * Absolute page file path.
 *
 * @returns {string}
 * Public route path.
 */

export function getOriginalRoutePath(filePath) {
  let route = filePath.replace(PAGES_DIR, '').replace('/page.vex', '');
  if (!route.startsWith('/')) route = '/' + route;
  return route;
}

/**
 * Retrieves all page files (`page.html`) in the pages directory.
 * Optionally includes layout files (`layout.html`).
 * 
 * @param {Object} [options]
 * @param {boolean} [options.layouts=false]
 * Whether to include layout files in the results.
 * 
 * @async
 * @returns {Promise<Array<{ fullpath: string, path: string }>>}
 */
export async function getPageFiles({ layouts = false } = {}) {
  const pageFiles = await readDirectoryRecursive(PAGES_DIR);
  const htmlFiles = pageFiles.filter((file) =>
    file.fullpath.endsWith("page.vex") || (layouts && file.name === "layout.vex")
  );

  return htmlFiles;
}

/**
 * Converts a page file path into a server routing path.
 *
 * Dynamic segments `[param]` are converted to `:param`
 * for Express-style routing.
 *
 * @param {string} filePath
 * Absolute page file path.
 *
 * @returns {string}
 * Server route path.
 */
export function getRoutePath(filePath) {
  let route = filePath.replace(PAGES_DIR, '').replace('/page.vex', '');
  route = route.replace(/\[([^\]]+)\]/g, ':$1'); // [param] -> :param

  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  return route;
}

/**
 * Writes a client component JS module to disk.
 *
 * @async
 * @param {string} componentName
 * Autogenerated component name.
 *
 * @param {string} jsModuleCode
 * JavaScript module source.
 *
 * @returns {Promise<void>}
 */
export async function saveClientComponentModule(componentName, jsModuleCode) {
  const outputPath = path.join(CLIENT_COMPONENTS_DIR, `${componentName}.js`);

  await writeFile(outputPath, jsModuleCode, "utf-8");
}

/**
 * Resolves an import path relative to the project root
 * and returns filesystem and file URL representations.
 *
 * @param {string} importPath
 * Import path as declared in source code.
 *
 * @returns {{
 *   path: string,
 *   fileUrl: string,
 *   importPath: string
 * }}
 */
export async function getImportData(importPath, callerFilePath = null) {
  let resolvedPath;
  if (importPath.startsWith("vex/server/")) {
    resolvedPath = path.resolve(FRAMEWORK_DIR, importPath.replace("vex/server/", "server/"));
  } else if (importPath.startsWith("vex/")) {
    resolvedPath = path.resolve(FRAMEWORK_DIR, "client/services", importPath.replace("vex/", ""));
  } else if (importPath.startsWith("@/") || importPath === "@") {
    resolvedPath = path.resolve(SRC_DIR, importPath.replace(/^@\//, "").replace(/^@$/, ""));
  } else if ((importPath.startsWith("./") || importPath.startsWith("../")) && callerFilePath) {
    // Relative import — resolve against the caller component's directory, not ROOT_DIR.
    // Without this, `import Foo from './foo.vex'` inside a nested component would be
    // resolved from the project root instead of from the file that contains the import.
    resolvedPath = path.resolve(path.dirname(callerFilePath), importPath);
  } else {
    resolvedPath = path.resolve(ROOT_DIR, importPath);
  }

  // Auto-resolve directory → index.js
  if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
    resolvedPath = path.join(resolvedPath, "index.js");
  }

  const fileUrl = pathToFileURL(resolvedPath).href;
  return { path: resolvedPath, fileUrl, importPath };
}

