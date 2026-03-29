import { watch } from "fs";
import fs from "fs/promises";
import path from "path";
import esbuild from "esbuild";
import { compileTemplateToHTML } from "./template.js";
import { getOriginalRoutePath, getPageFiles, getRoutePath, saveClientComponentModule, saveClientRoutesFile, saveComponentHtmlDisk, saveServerRoutesFile, readFile, getImportData, generateComponentId, adjustClientModulePath, PAGES_DIR, ROOT_HTML_DIR, getLayoutPaths, SRC_DIR, WATCH_IGNORE, WATCH_IGNORE_FILES, CLIENT_COMPONENTS_DIR, USER_GENERATED_DIR } from "./files.js";
import { renderComponents } from "./streaming.js";
import { getRevalidateSeconds } from "./cache.js";
import { withCache } from "./data-cache.js";
import { createVexAliasPlugin } from "./esbuild-plugin.js";

/**
 * Throws a structured redirect error that propagates out of getData and is
 * caught by the router to issue an HTTP redirect response (FEAT-02).
 *
 * Available automatically inside every <script server> block — no import needed.
 *
 * @param {string} redirectPath     - The path or URL to redirect to.
 * @param {number} [statusCode=302] - HTTP redirect status (301, 302, 307, 308).
 * @throws {Error} Always throws — use inside getData to abort rendering.
 *
 * @example
 * async function getData({ req }) {
 *   if (!VALID_CITIES.includes(req.params.city)) redirect('/not-found', 302);
 *   return { city: req.params.city };
 * }
 */
function redirect(redirectPath, statusCode = 302) {
  const err = new Error("REDIRECT");
  err.redirect = { path: redirectPath, statusCode };
  throw err;
}

/**
 * In-memory cache for parsed `.html` component files.
 *
 * `processHtmlFile` does three expensive things per call:
 *   1. `fs.readFile` — disk I/O
 *   2. Regex extraction of <script server>, <script client> and <template> blocks
 *   3. `new AsyncFunction(...)` + execution to extract getData / getMetadata / getStaticPaths
 *
 * None of these results change between requests for the same file, so the output
 * can be safely reused across the lifetime of the process — in both dev and production.
 *
 * In production files never change, so entries are kept forever.
 * In dev, a file watcher (see below) deletes stale entries whenever a .html file is saved,
 * so the next request re-parses and re-populates the cache automatically.
 *
 * Key:   absolute file path (e.g. /project/pages/home/page.html)
 * Value: the object returned by _processHtmlFile (getData, template, serverComponents, …)
 */
const processHtmlFileCache = new Map();

/**
 * Root HTML shell read once at module load.
 *
 * `root.html` is a static wrapper (doctype, <head>, <body>) that never changes
 * between requests. Reading it from disk on every SSR request is pure waste.
 *
 * Because this module is ESM, top-level `await` is valid and the read is
 * completed before any request handler can call `renderLayouts`, so there is
 * no race condition. Subsequent calls to `renderLayouts` use the already-resolved
 * value with zero I/O.
 *
 * In production the value is kept for the lifetime of the process (files are
 * immutable after deploy). In dev the watcher below refreshes it on save.
 */
let rootTemplate = await readFile(ROOT_HTML_DIR);

/**
 * In dev only: watch pages/, components/ and root.html for .html changes.
 *
 * - pages/ and components/: evicts the processHtmlFileCache entry for the
 *   changed file so the next request re-parses it from disk.
 * - root.html: re-reads the file and updates `rootTemplate` so the new shell
 *   is used immediately without restarting the process.
 *
 * This watcher is intentionally skipped in production because:
 *  - files are immutable after deploy, so invalidation is never needed
 *  - `fs.watch` keeps the Node process alive and consumes inotify/kqueue handles
 */
if (process.env.NODE_ENV !== "production") {
  // Lazy import — hmr.js is never loaded in production
  const { hmrEmitter } = await import("./hmr.js");

  // Watch SRC_DIR (configured via vex.config.json `srcDir`, defaults to project root).
  // Skip any path segment that appears in WATCH_IGNORE to avoid reacting to
  // changes inside node_modules, build outputs, or other non-source directories.
  // Individual file patterns can be excluded via `watchIgnoreFiles` in vex.config.json.
  watch(SRC_DIR, { recursive: true }, async (_, filename) => {
      if (!filename) return;
      if (filename.split(path.sep).some(part => WATCH_IGNORE.has(part))) return;
      const normalizedFilename = filename.replace(/\\/g, "/");
      if (WATCH_IGNORE_FILES.some(pattern => path.matchesGlob(normalizedFilename, pattern))) return;

      if (filename.endsWith(".vex")) {
        const fullPath = path.join(SRC_DIR, filename);

        // 1. Evict all in-memory caches for this file
        processHtmlFileCache.delete(fullPath);
        processedComponentsInBuild.delete(fullPath);

        // 2. Re-generate client bundle so the browser gets fresh JS (FEAT-03 HMR)
        try {
          await generateComponentAndFillCache(fullPath);
        } catch (e) {
          console.error(`[HMR] Re-generation failed for ${filename}:`, e.message);
        }

        // 3. Notify connected browsers to reload
        hmrEmitter.emit("reload", filename);
      } else if (filename.endsWith(".js")) {
        // Rebuild the changed user JS file so npm imports are re-bundled.
        const fullPath = path.join(SRC_DIR, filename);
        try {
          await buildUserFile(fullPath);
        } catch (e) {
          console.error(`[HMR] Failed to rebuild user file ${filename}:`, e.message);
        }
        hmrEmitter.emit("reload", filename);
      }
    });

  // root.html is a single file — watch it directly
  watch(ROOT_HTML_DIR, async () => {
    rootTemplate = await readFile(ROOT_HTML_DIR);
    hmrEmitter.emit("reload", "root.html");
  });
}

const DEFAULT_METADATA = {
  title: "Vanilla JS App",
  description: "Default description",
};

/**
 * Parses an ES module script block and extracts:
 * - Server-side imports (executed immediately)
 * - HTML component imports
 * - Client-side imports (without execution)
 *
 * When `isClientSide` is enabled, JavaScript modules are not executed,
 * preventing side effects during server rendering.
 *
 * @async
 * @param {string} script
 * Raw script contents extracted from <script> block.
 *
 * @param {boolean} [isClientSide=false]
 * Whether the script is client-only.
 *
 * @returns {Promise<{
 *   imports: Record<string, any>,
 *   componentRegistry: Map<string, {
 *     path: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>,
 *   clientImports: Record<string, {
 *     fileUrl: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>
 * }>}
 */
const getScriptImports = async (script, isClientSide = false, filePath = null) => {
  const componentRegistry = new Map();
  const imports = {};
  const clientImports = {};
  const importRegex =
    /import\s+(?:([a-zA-Z_$][\w$]*)|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  // Process imports
  while ((match = importRegex.exec(script)) !== null) {
    const [importStatement, defaultImport, namedImports, modulePath] = match;

    const { path, fileUrl } = await getImportData(modulePath, filePath);

    if (path.endsWith(".vex")) {
      // Recursively process HTML component
      if (defaultImport) {
        componentRegistry.set(defaultImport, {
          path: path,
          originalPath: modulePath,
          importStatement,
        });
      }
    } else if (!isClientSide) {
      // Import JS module
      const module = await import(fileUrl);
      if (defaultImport) {
        imports[defaultImport] = module.default || module[defaultImport];
      }
      if (namedImports) {
        namedImports.split(",").forEach((name) => {
          const trimmedName = name.trim();
          imports[trimmedName] = module[trimmedName];
        });
      }
    } else if (defaultImport) {
      // client side default imports and named imports
      const adjustedClientModule = adjustClientModulePath(modulePath, importStatement, filePath);
      clientImports[defaultImport || namedImports] = {
        fileUrl,
        originalPath: adjustedClientModule.path,
        importStatement: adjustedClientModule.importStatement,
        originalImportStatement: importStatement,
      };
    } else {
      namedImports.split(",").forEach((name) => {
        const trimmedName = name.trim();
        const adjustedClientModule = adjustClientModulePath(modulePath, importStatement, filePath);
        clientImports[trimmedName] = {
          fileUrl,
          originalPath: adjustedClientModule.path,
          importStatement: adjustedClientModule.importStatement,
          originalImportStatement: importStatement,
        };
      });
    }
  }

  return { imports, componentRegistry, clientImports };
};

/**
 * Raw implementation of the file parser — called only when the cache misses.
 * Do not call directly; use the exported `processHtmlFile` wrapper instead.
 *
 * Parses an HTML page or component file and extracts:
 * - Server-side logic
 * - Client-side code
 * - HTML template
 * - Metadata & data-fetching hooks
 * - Component dependency graphs
 *
 * Server-side scripts are executed in a sandboxed async context.
 *
 * @async
 * @param {string} filePath
 * Absolute path to the HTML file.
 *
 * @returns {Promise<{
 *   getStaticPaths: (() => Promise<Array<{ params: Record<string, string | number> }>>) | null,
 *   getData: (() => Promise<any>) | null,
 *   getMetadata: (() => Promise<any>) | null,
 *   template: string,
 *   clientCode: string,
 *   clientImports: Record<string, {
 *     fileUrl: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>,
 *   serverComponents: Map<string, {
 *     path: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>,
 *   clientComponents: Map<string, {
 *     path: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>
 * }>}
 */
async function _processHtmlFile(filePath) {
  const content = await readFile(filePath);

  const serverMatch = content.match(/<script server>([\s\S]*?)<\/script>/);
  const clientMatch = content.match(/<script client>([\s\S]*?)<\/script>/);
  const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);

  const template = templateMatch ? templateMatch[1].trim() : "";
  const clientCode = clientMatch ? clientMatch[1].trim() : "";
  let serverComponents = new Map();
  let clientComponents = new Map();
  let clientImports = {};

  let getData = null;
  let getStaticPaths = null;
  let getMetadata = null;

  if (serverMatch) {
    const scriptContent = serverMatch[1];
    const { componentRegistry, imports } = await getScriptImports(
      scriptContent
    );

    serverComponents = componentRegistry;

    // Clean script and execute
    const cleanedScript = scriptContent
      .replace(
        /import\s+(?:(?:[a-zA-Z_$][\w$]*)|\{[^}]*\})\s+from\s+['"][^'"]*['"];?\n?/g,
        ""
      )
      .replace(/export\s+/g, "")
      .trim();

    if (cleanedScript) {
      const AsyncFunction = Object.getPrototypeOf(
        async function () { }
      ).constructor;
      // `redirect` and `withCache` are the first two params so they are in
      // scope for the script closure — including inside getData.
      const fn = new AsyncFunction(
        "redirect",
        "withCache",
        ...Object.keys(imports),
        `
        ${cleanedScript}
        ${!cleanedScript.includes("getData") ? "const getData = null;" : ""}
        ${!cleanedScript.includes("const metadata = ") ? "const metadata = null;" : ""}
        ${!cleanedScript.includes("getMetadata") ? "const getMetadata = null;" : ""}
        ${!cleanedScript.includes("getStaticPaths") ? "const getStaticPaths = null;" : ""}
        return { getData, metadata, getMetadata, getStaticPaths };
      `
      );

      try {
        const result = await fn(redirect, withCache, ...Object.values(imports));
        getData = result.getData;
        getStaticPaths = result.getStaticPaths;
        getMetadata = result.metadata ? () => result.metadata : result.getMetadata;
      } catch (error) {
        console.error(`Error executing script in ${filePath}:`, error.message);
      }
    }
  }

  if (clientMatch) {
    const { componentRegistry, clientImports: newClientImports } = await getScriptImports(clientMatch[1], true, filePath);
    clientComponents = componentRegistry;
    clientImports = newClientImports;
  }

  return {
    getStaticPaths,
    getData,
    getMetadata,
    template,
    clientCode,
    serverComponents,
    clientComponents,
    clientImports,
  };
}

/**
 * Cached wrapper around `_processHtmlFile`.
 *
 * Returns the cached result on subsequent calls for the same file, avoiding
 * repeated disk reads and AsyncFunction construction on every SSR request.
 * The cache is populated on first access and evicted in dev when the file changes
 * (see `processHtmlFileCache` watcher above).
 *
 * @param {string} filePath - Absolute path to the .html component file.
 * @returns {Promise<ReturnType<_processHtmlFile>>}
 */
export async function processHtmlFile(filePath) {
  if (processHtmlFileCache.has(filePath)) return processHtmlFileCache.get(filePath);
  const result = await _processHtmlFile(filePath);
  processHtmlFileCache.set(filePath, result);
  return result;
}

/**
 * Renders an HTML file using server-side data and metadata hooks.
 *
 * @async
 * @param {string} filePath
 * Absolute path to the HTML file.
 *
 * @param {{
 *   req: import("http").IncomingMessage,
 *   res: import("http").ServerResponse,
 *   [key: string]: any
 * }} [context={}]
 * 
 * @param {object} [extraComponentData={}]
 * Additional data to pass to the component during rendering.
 *
 * @returns {Promise<{
 *   html: string,
 *   metadata: object | null,
 *   clientCode: string,
 *   serverComponents: Map<string, any>,
 *   clientComponents: Map<string, any>,
 *   clientImports: Record<string, {
 *     fileUrl: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>,
 * }>}
 */
export async function renderHtmlFile(filePath, context = {}, extraComponentData = {}) {
  const {
    getData,
    getMetadata,
    template,
    clientCode,
    serverComponents,
    clientComponents,
    clientImports,
  } = await processHtmlFile(filePath);

  const componentData = getData ? await getData(context) : {};
  const metadata = getMetadata ? await getMetadata({ req: context.req, props: componentData }) : null;
  const html = compileTemplateToHTML(template, { ...componentData, ...extraComponentData });

  return { html, metadata, clientCode, serverComponents, clientComponents, clientImports };
}

/**
 * Generates final <script> tags for client-side execution,
 * including scripts and component modules.
 *
 * @param {{
 *   clientCode: string,
 *   clientComponentsScripts?: string[],
 *   clientComponents?: Map<string, {
 *     path: string,
 *     originalPath: string,
 *     importStatement: string
 *   }>,
 * }} params
 *
 * @returns {string}
 * HTML-safe script tag string.
 */
function generateClientScriptTags({
  clientCode,
  clientImports = {},
  clientComponentsScripts = [],
  clientComponents = new Map(),
}) {
  if (!clientCode) return "";
  // replace component imports to point to .js files
  for (const { importStatement } of clientComponents.values()) {
    clientCode = clientCode.replace(`${importStatement};`, '').replace(importStatement, "");
  }

  // Rewrite framework and user utility imports to browser-accessible paths
  for (const importData of Object.values(clientImports)) {
    if (importData.originalImportStatement && importData.importStatement !== importData.originalImportStatement) {
      clientCode = clientCode.replace(importData.originalImportStatement, importData.importStatement);
    }
  }

  const clientCodeWithoutComponentImports = clientCode
    .split("\n")
    .filter((line) => !/^\s*import\s+.*['"].*\.vex['"]/.test(line))
    .join("\n")
    .trim();

  const scripts = `
    ${clientCodeWithoutComponentImports.trim()
      ? `<script type="module">\n${clientCodeWithoutComponentImports}\n</script>`
      : ""
    }
    ${clientComponentsScripts?.length ? clientComponentsScripts.join("\n") : ""}
  `;

  return scripts.trim();
}

/**
 * Renders a page with server and client components.
 * @param {string} pagePath 
 * @param {{
 *   req: import("http").IncomingMessage,
 *   res: import("http").ServerResponse,
 *   [key: string]: any
 * }} [ctx={}]
 * @param {boolean} [awaitSuspenseComponents=false]
 * @param {object} [extraComponentData={}]
 * @returns {Promise<{
 *  html: string,
 *  metadata: object,
 *  clientCode: string,
 *  serverComponents: Map<string, any>,
 *  clientComponents: Map<string, any>,
 *  suspenseComponents: Array<{ id: string, content: string }>,
 *  clientComponentsScripts: string[],
 * }>
 */
async function renderPage(pagePath, ctx, awaitSuspenseComponents = false, extraComponentData = {}) {
  const {
    html,
    metadata,
    clientCode,
    clientImports,
    serverComponents,
    clientComponents,
  } = await renderHtmlFile(pagePath, ctx, extraComponentData);

  const {
    html: htmlWithComponents,
    suspenseComponents,
    clientComponentsScripts = [],
  } = await renderComponents({
    html,
    serverComponents,
    clientComponents,
    awaitSuspenseComponents,
  });

  return {
    html: htmlWithComponents,
    metadata,
    clientCode,
    clientImports,
    serverComponents,
    clientComponents,
    suspenseComponents,
    clientComponentsScripts,
  }
}

/**
 * Renders nested layouts for a given page.
 * @param {string} pagePath 
 * @param {string} pageContent 
 * @param {object} [pageHead={}] 
 * @returns {Promise<string>}
 */
async function renderLayouts(pagePath, pageContent, pageHead = {}) {
  const layoutPaths = await getLayoutPaths(pagePath);

  let currentContent = pageContent;
  let deepMetadata = pageHead.metadata || {};

  // Render layouts from innermost to outermost
  for (let i = layoutPaths.length - 1; i >= 0; i--) {
    const layoutPath = layoutPaths[i];
    
    try {
      const { html, metadata } = await renderPage(layoutPath, {}, false, {
        props: {
          children: currentContent
        }
      });
      
      deepMetadata = { ...deepMetadata, ...metadata };
      currentContent = html;
    } catch (error) {
      console.warn(`Error rendering ${layoutPath}, skipping`);
      continue;
    }
  }

  // wrap in root — rootTemplate is pre-loaded at module level
  const { clientScripts, ...restPageHead } = pageHead;
  currentContent = compileTemplateToHTML(rootTemplate, {
    ...restPageHead,
    metadata: deepMetadata,
    props: {
      children: currentContent
    }
  });

  // Inject framework internals + page client scripts before </head>
  // so users don't need to reference framework scripts in their root.html
  const devMode = process.env.NODE_ENV !== "production";
  const frameworkScripts = [
    `<style>vex-root { display: contents; }</style>`,
    `<script type="module" src="/_vexjs/services/index.js"></script>`,
    `<script src="/_vexjs/services/hydrate-client-components.js"></script>`,
    `<script src="/_vexjs/services/hydrate.js" id="hydrate-script"></script>`,
    devMode ? `<script src="/_vexjs/services/hmr-client.js"></script>` : "",
    clientScripts || "",
  ].filter(Boolean).join("\n  ");

  currentContent = currentContent.replace("</head>", `  ${frameworkScripts}\n</head>`);

  return currentContent;
}

/**
 * Renders a page wrapped in the global layout.
 *
 * Supports:
 * - Server components
 * - Suspense streaming
 * - Client hydration
 *
 * @async
 * @param {string} pagePath
 * Absolute path to page.html.
 *
 * @param {{
 *   req: import("http").IncomingMessage,
 *   res: import("http").ServerResponse,
 *   [key: string]: any
 * }} [ctx={}]
 *
 * @param {boolean} [awaitSuspenseComponents=false]
 * Whether suspense components should be rendered immediately.
 *
 * @returns {Promise<{
 *   html: string,
 *   pageHtml: string,
 *   metadata: object,
 *   suspenseComponents: Array<{ id: string, content: string }>,
 *   serverComponents: Map<string, any>,
 *   clientComponents: Map<string, any>
 * }>}
 */
export async function renderPageWithLayout(pagePath, ctx = {}, awaitSuspenseComponents = false) {
  const {
    html: pageHtml,
    metadata,
    clientCode,
    clientImports,
    serverComponents,
    clientComponents,
    suspenseComponents,
    clientComponentsScripts,
  } = await renderPage(pagePath, ctx, awaitSuspenseComponents);


  // Wrap in layout
  const clientScripts = generateClientScriptTags({
    clientCode,
    clientImports,
    clientComponentsScripts,
    clientComponents,
  });

  const html = await renderLayouts(pagePath, pageHtml, {
    clientScripts,
    metadata: { ...DEFAULT_METADATA, ...metadata },
  })

  return {
    html,
    pageHtml,
    metadata,
    suspenseComponents,
    serverComponents,
    clientComponents,
  };
}

/**
 * Converts a Vue-like template syntax into an `html`` tagged template.
 *
 * Supports:
 * - v-for, v-if, v-else-if, v-else, v-show
 * - Reactive `.value` auto-detection
 * - Property & event bindings
 *
 * @param {string} template
 * Vue-like template string.
 *
 * @param {string} [clientCode=""]
 * Client-side code used to detect reactive variables.
 *
 * @returns {string}
 * Converted tagged-template HTML.
 */
function convertVueToHtmlTagged(template, clientCode = "") {
  const reactiveVars = new Set();
  const reactiveRegex =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:reactive|computed)\(/g;

  let match;

  while ((match = reactiveRegex.exec(clientCode)) !== null) {
    reactiveVars.add(match[1]);
  }

  /**
   * Helper to add .value only to reactive variables
   * Preserves member access (e.g., counter.value stays as counter.value)
   * Preserves method calls (e.g., increment() stays as increment())
   */
  const processExpression = (expr) => {
    return expr.replace(/\b(\w+)(?!\s*[\.\(])/g, (_, varName) => {
      return reactiveVars.has(varName) ? `${varName}.value` : varName;
    });
  };

  let result = template.trim();

  // Self-closing x-for="item in items" → ${items.value.map(item => html`<Component ... />`)}
  result = result.replace(
    /<([\w-]+)([^>]*)\s+x-for="(\w+)\s+in\s+([^"]+)(?:\.value)?"([^>]*)\/>/g,
    (_, tag, beforeAttrs, iterVar, arrayVar, afterAttrs) => {
      const cleanExpr = arrayVar.trim();
      const isSimpleVar = /^\w+$/.test(cleanExpr);
      const arrayAccess = isSimpleVar && reactiveVars.has(cleanExpr)
        ? `${cleanExpr}.value`
        : cleanExpr;
      return `\${${arrayAccess}.map(${iterVar} => html\`<${tag}${beforeAttrs}${afterAttrs} />\`)}`;
    }
  );

  // x-for="item in items" → ${items.value.map(item => html`...`)}
  result = result.replace(
    /<([\w-]+)([^>]*)\s+x-for="(\w+)\s+in\s+([^"]+)(?:\.value)?"([^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, beforeAttrs, iterVar, arrayVar, afterAttrs, content) => {
      const cleanExpr = arrayVar.trim();
      const isSimpleVar = /^\w+$/.test(cleanExpr);
      const arrayAccess = isSimpleVar && reactiveVars.has(cleanExpr)
        ? `${cleanExpr}.value`
        : cleanExpr;
      return `\${${arrayAccess}.map(${iterVar} => html\`<${tag}${beforeAttrs}${afterAttrs}>${content}</${tag}>\`)}`;
    }
  );

  // x-show="condition" → x-show="${condition.value}" (add .value for reactive vars)
  result = result.replace(/x-show="([^"]+)"/g, (_, condition) => {
    return `x-show="\${${processExpression(condition)}}"`;
  });

  // {{variable}} → ${variable.value} (for reactive vars)
  result = result.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    return `\${${processExpression(expr.trim())}}`;
  });

  // @click="handler" → @click="${handler}" (no .value for functions)
  result = result.replace(/@(\w+)="([^"]+)"/g, (_, event, handler) => {
    const isArrowFunction = /^\s*\(?.*?\)?\s*=>/.test(handler);
    const isFunctionCall = /[\w$]+\s*\(.*\)/.test(handler.trim());

    if (isArrowFunction) {
      return `@${event}="\${${handler.trim()}}"`;
    } else if (isFunctionCall) {
      return `@${event}="\${() => ${handler.trim()}}"`;
    } else {
      return `@${event}="\${${handler.trim()}}"`;
    }
  });

  // :prop="value" → :prop="${value.value}" (for reactive vars, but skip already processed ${...})
  result = result.replace(/:(\w+)="(?!\$\{)([^"]+)"/g, (_, attr, value) => {
    return `:${attr}='\${${processExpression(value)}}'`;
  });

  // x-if="condition" → x-if="${condition}"
  result = result.replace(/x-if="([^"]*)"/g, 'x-if="${$1}"');

  // x-else-if="condition" → x-else-if="${condition}"
  result = result.replace(/x-else-if="([^"]*)"/g, 'x-else-if="${$1}"');

  return result;
}


/**
 * Generates and bundles a client-side JS module for a hydrated component using esbuild.
 *
 * Previously this function assembled the output by hand: it collected import statements,
 * deduped them with getClientCodeImports, and concatenated everything into a JS string.
 * That approach had two fundamental limitations:
 *   1. npm package imports (bare specifiers like 'lodash') were left unresolved in the
 *      output — the browser has no module resolver and would throw at runtime.
 *   2. Transitive user utility files (@/utils/foo imported by @/utils/bar) were not
 *      bundled; they were served on-the-fly at runtime by the /_vexjs/user/* handler,
 *      adding an extra network round-trip per utility file on page load.
 *
 * With esbuild the entry source is passed via stdin and esbuild takes care of:
 *   - Resolving and inlining @/ user imports and their transitive dependencies
 *   - Resolving and bundling npm packages from node_modules
 *   - Deduplicating shared modules across the bundle
 *   - Writing the final ESM output directly to the destination file
 *
 * Framework singletons (vex/*, .app/*) are intentionally NOT bundled. They are
 * marked external by the vex-aliases plugin so the browser resolves them at runtime
 * from /_vexjs/services/, ensuring a single shared instance per page. Bundling them
 * would give each component its own copy of reactive.js, breaking shared state.
 *
 * @async
 * @param {{
 *   clientCode: string,
 *   template: string,
 *   metadata: object,
 *   clientImports: Record<string, { originalImportStatement: string }>,
 *   clientComponents: Map<string, any>,
 *   componentFilePath: string,
 *   componentName: string,
 * }} params
 *
 * @returns {Promise<null>}
 * Always returns null — esbuild writes the bundle directly to disk.
 */
export async function generateClientComponentModule({
  clientCode,
  template,
  metadata,
  clientImports,
  clientComponents,
  componentFilePath,
  componentName,
}) {
  if (!clientCode && !template) return null;

  // ── 1. Resolve default props from xprops() ─────────────────────────────────
  const defaults = extractVPropsDefaults(clientCode);
  const clientCodeWithProps = addComputedProps(clientCode, defaults);

  // ── 2. Build the function body: remove xprops declaration and import lines ──
  // Imports are hoisted to module level in the entry source (step 4).
  const cleanClientCode = clientCodeWithProps
    .replace(/const\s+props\s*=\s*xprops\s*\([\s\S]*?\)\s*;?/g, "")
    .replace(/^\s*import\s+.*$/gm, "")
    .trim();

  // ── 3. Convert Vue-like template syntax to html`` tagged template ───────────
  const convertedTemplate = convertVueToHtmlTagged(template, clientCodeWithProps);
  const { html: processedHtml } = await renderComponents({ html: convertedTemplate, clientComponents });

  // ── 4. Collect module-level imports for the esbuild entry source ────────────
  // Use originalImportStatement (the specifier as written by the developer, before
  // any path rewriting). esbuild receives the original specifiers and the alias
  // plugin translates them at bundle time — no pre-rewriting needed here.
  const importLines = new Set(
    Object.values(clientImports)
      .map((ci) => ci.originalImportStatement)
      .filter(Boolean)
  );

  // Ensure effect and html are always available in the component body.
  // If the developer already imported them the alias plugin's deduplication
  // in esbuild's module graph handles the overlap — no duplicate at runtime.
  const hasEffect = [...importLines].some((l) => /\beffect\b/.test(l));
  const hasHtml = [...importLines].some((l) => /\bhtml\b/.test(l));
  if (!hasEffect) importLines.add("import { effect } from 'vex/reactive';");
  if (!hasHtml) importLines.add("import { html } from 'vex/html';");

  // ── 5. Assemble the esbuild entry source ────────────────────────────────────
  // This is a valid ESM module that esbuild will bundle. Imports at the top,
  // hydrateClientComponent exported as a named function.
  // Add persistent wrapper element anchors the component in the DOM so that
  // re-renders always have a stable target to replace children into.
  // Using a plain Element (never a DocumentFragment) avoids the fragment-drain
  // problem: after marker.replaceWith(fragment) the fragment empties and
  // disconnects, making subsequent root.replaceWith() calls silently no-op.
  const entrySource = `
${[...importLines].join("\n")}

export const metadata = ${JSON.stringify(metadata)};

export function hydrateClientComponent(marker, incomingProps = {}) {
  ${cleanClientCode}

  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);

  function render() {
    const node = html\`${processedHtml}\`;
    wrapper.replaceChildren(node);
  }

  effect(() => render());
  return wrapper;
}
`.trim();

  // ── 6. Bundle with esbuild ──────────────────────────────────────────────────
  // stdin mode: esbuild receives the generated source as a virtual file.
  // resolveDir tells esbuild which directory to use when resolving relative
  // imports — it must be the .vex source file's directory so that './utils/foo'
  // resolves relative to where the developer wrote the import, not relative to
  // the framework's internal directories.
  const outfile = path.join(CLIENT_COMPONENTS_DIR, `${componentName}.js`);

  const isProd = process.env.NODE_ENV === "production";
  await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: componentFilePath ? path.dirname(componentFilePath) : CLIENT_COMPONENTS_DIR,
    },
    bundle: true,
    outfile,
    format: "esm",
    platform: "browser",
    plugins: [createVexAliasPlugin()],
    minify: isProd,
    // Silence esbuild's default stdout logging — the framework has its own output
    logLevel: "silent",
  });

  // esbuild wrote directly to outfile — no string to return
  return null;
}

/**
 * Determines if a page can be fully client-side rendered (CSR)
 * @param {number | string} revalidate 
 * @param {boolean} hasServerComponents 
 * @param {boolean} hasGetData
 * @returns 
 */
function getIfPageCanCSR(revalidate, hasServerComponents, hasGetData) {
  const revalidateSeconds = getRevalidateSeconds(revalidate ?? 0);
  const neverRevalidate = revalidateSeconds === -1;
  const canCSR = !hasServerComponents && (neverRevalidate || !hasGetData);

  return canCSR;
}

/**
 * Generates static HTML for a server component.
 *
 * Supports:
 * - getStaticPaths
 * - ISR pre-rendering
 *
 * @async
 * @param {string} componentPath
 * Absolute path to the HTML component.
 *
 * @returns {Promise<Array<{
 *  canCSR: boolean,
 *  htmls: Array<{
 *    params: Record<string, string | number>,
 *    html: string, // full html with layout
 *    pageHtml: string // only page html without layout
 *  }>
 * }>>}
 */
async function generateServerComponentHTML(componentPath) {
  const {
    getStaticPaths,
    getData,
    getMetadata,
    serverComponents,
    ...restProcessHtmlFile
  } = await processHtmlFile(componentPath);

  const metadata = getMetadata ? await getMetadata({ req: { params: {} }, props: {} }) : null;
  const canCSR = getIfPageCanCSR(
    metadata?.revalidate,
    serverComponents.size > 0,
    typeof getData === "function"
  );

  const paths = getStaticPaths ? await getStaticPaths() : [];

  const result = {
    htmls: [],
    canCSR,
    metadata,
    getStaticPaths,
    getData,
    getMetadata,
    serverComponents,
    ...restProcessHtmlFile,
  };

  const isPage = componentPath.includes(PAGES_DIR);

  if(!isPage) {
    return result;
  }

  // If no static paths and getData exists, render once with empty params
  if (paths.length === 0 && !!getData) {
    const {
      html,
      pageHtml,
      metadata: pageMetadata,
    } =
      await renderPageWithLayout(componentPath, {}, true);

    result.htmls.push({ params: {}, html, pageHtml, metadata: pageMetadata });

    return result;
  }

  for (const path of paths) {
    const { html, pageHtml, metadata } =
      await renderPageWithLayout(componentPath, { req: path }, true);

    result.htmls.push({ params: path.params, html, pageHtml, metadata });
  }

  return result;
}

/**
 * Generates a client-side hydration placeholder `<template>` for a given component.
 *
 * This function creates a `<template>` element containing metadata that allows
 * the client to dynamically hydrate the component. The `data-client:component`
 * attribute stores a unique import identifier, and `data-client:props` stores
 * the component's props as a JSON-like string, supporting both static values
 * and runtime interpolations (e.g., `${variable}`).
 *
 * @param {string} componentName - The logical name of the component.
 * @param {string} componentAbsPath - The absolute file path of the component (resolved by getImportData).
 * @param {Record<string, any>} [props={}] - An object of props to pass to the component.
 *                                            Values can be literals or template
 *                                            interpolations (`${…}`) for dynamic evaluation.
 *
 * @returns {Promise<string>} A promise that resolves to a string containing
 *                            the `<template>` HTML for hydration.
 */
export async function processClientComponent(componentName, componentAbsPath, props = {}) {
  const targetId = `client-${componentName}-${Date.now()}`;

  // componentAbsPath is the absolute resolved path — generateComponentId strips ROOT_DIR
  // internally, so this produces the same hash as the bundle filename written by
  // generateComponentAndFillCache (which also calls generateComponentId with the abs path).
  const componentImport = generateComponentId(componentAbsPath);
  const propsJson = serializeClientComponentProps(props);
  const html = `<template id="${targetId}" data-client:component="${componentImport}" data-client:props='${propsJson}'></template>`;
  
  return html;
}

function isTemplateExpression(value) {
  return typeof value === "string" && /^\$\{[\s\S]+\}$/.test(value.trim());
}

function serializeRuntimePropValue(value) {
  if (!isTemplateExpression(value)) {
    return JSON.stringify(value);
  }

  return value.trim().slice(2, -1).trim();
}

function serializeClientComponentProps(props = {}) {
  const hasDynamicValues = Object.values(props).some(isTemplateExpression);

  if (!hasDynamicValues) {
    return JSON.stringify(props);
  }

  const serializedEntries = Object.entries(props).map(([key, value]) => {
    return `${JSON.stringify(key)}: ${serializeRuntimePropValue(value)}`;
  });

  return `\${JSON.stringify({ ${serializedEntries.join(", ")} })}`;
}

/**
 * Extract xprops object literal from client code
 * @param {string} clientCode
 * @returns {string | null}
 */
function extractVPropsObject(clientCode) {
  const match = clientCode.match(/xprops\s*\(\s*(\{[\s\S]*?\})\s*\)/);
  return match ? match[1] : null;
}

/**
 * Extract default values from xprops definition
 * @param {string} clientCode
 * @returns {object} Object with prop names and their default values
 */
function extractVPropsDefaults(clientCode) {
  const xpropsLiteral = extractVPropsObject(clientCode);
  if (!xpropsLiteral) return {};

  const xpropsDef = safeObjectEval(xpropsLiteral);
  const defaults = {};

  for (const key in xpropsDef) {
    const def = xpropsDef[key];
    if (def && typeof def === "object" && "default" in def) {
      defaults[key] = def.default;
    }
  }

  return defaults;
}

/**
 * Safely evaluates an object literal without executing side effects.
 *
 * @param {string} objectLiteral
 * @returns {object}
 */
function safeObjectEval(objectLiteral) {
  return Function(`"use strict"; return (${objectLiteral})`)();
}

/**
 * Applies default props from xprops definition
 * @param {object} xpropsDef
 * @param {object} componentProps
 * @returns {object}
 */
function applyDefaultProps(xpropsDefined, componentProps) {
  const finalProps = {};
  for (const key in xpropsDefined) {
    const def = xpropsDefined[key];
    if (key in componentProps) {
      finalProps[key] = componentProps[key];
    } else if ("default" in def) {
      finalProps[key] = def.default;
    } else {
      finalProps[key] = undefined;
    }
  }

  return finalProps;
}

/**
 * Compute props used in the client code
 * @param {string} clientCode
 * @param {object} componentProps
 */
function computeProps(clientCode, componentProps) {
  const xpropsLiteral = extractVPropsObject(clientCode);

  if (!xpropsLiteral) return componentProps;

  const xpropsDefined = safeObjectEval(xpropsLiteral);

  return applyDefaultProps(xpropsDefined, componentProps);
}

/**
 * Adds computed props to client code if are defined.
 * Replaces xprops(...) by const props = { ... };
 * @param {string} clientCode
 * @param {object} componentProps
 * 
 * @returns {string}
 */
function addComputedProps(clientCode, componentProps) {
  const xpropsRegex = /const\s+props\s*=\s*xprops\s*\([\s\S]*?\)\s*;?/;
  if (!xpropsRegex.test(clientCode)) return clientCode;

  const computedProps = computeProps(clientCode, componentProps);

  return clientCode.replace(
    xpropsRegex,
    `const props = { ...${JSON.stringify(computedProps)}, ...incomingProps };`
  );
}

async function getMetadataAndStaticPaths(getMetadata, getStaticPaths) {
  const promises = [];

  if (getMetadata) {
    promises.push(getMetadata({ req: { params: {} }, props: {} }));
  }
  if (getStaticPaths) {
    promises.push(getStaticPaths());
  }

  const [metadata, paths] = await Promise.all(promises);

  return {
    metadata: metadata || DEFAULT_METADATA,
    paths: paths || [],
  };
};

/**
 * Replaces route parameters with the provided values.
 *
 * This function takes a route that may contain multiple parameters in the `:param` format
 * and replaces them with the corresponding values from the `params` object.
 *
 * @example
 * // Route with multiple parameters
 * fillRoute("/user/:userId/post/:postId", { userId: 123, postId: 456 });
 * // Returns: "/user/123/post/456"
 *
 * @param {string} route - The route containing `:param` placeholders.
 * @param {Record<string, string|number>} params - An object with values to replace in the route.
 * @throws {Error} Throws an error if any parameter in the route is missing in `params`.
 * @returns {string} The final route with all parameters replaced.
 */
function fillRoute(route, params) {
  return route.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
    if (params[key] === undefined) {
      throw new Error(`Missing parameter "${key}"`);
    }
    return params[key];
  });
}
/**
 * Generates and saves the client-side JS bundle for a component.
 *
 * Delegates to generateClientComponentModule, which uses esbuild to bundle
 * the component's <script client> code into a self-contained ESM file written
 * directly to .vexjs/_components/<componentName>.js.
 *
 * componentFilePath is required so esbuild can resolve relative imports
 * (./utils/foo) from the correct base directory.
 *
 * @param {{
 *   metadata: object,
 *   clientCode: string,
 *   template: string,
 *   clientImports: Record<string, { originalImportStatement: string }>,
 *   clientComponents: Map<string, any>,
 *   componentName: string,
 *   componentFilePath: string,
 * }} params
 * @returns {Promise<void>}
 */
async function saveClientComponent({
  metadata,
  clientCode,
  template,
  clientImports,
  clientComponents,
  componentName,
  componentFilePath,
}) {
  await generateClientComponentModule({
    metadata,
    clientCode,
    template,
    clientImports,
    clientComponents,
    componentFilePath,
    componentName,
  });
}

/**x
 * Generates and persists either:
 * - Server-rendered HTML (SSG / ISR) for a component, or
 * - A client-side hydration module when SSR is not applicable.
 *
 * This function is executed at build-time and is responsible for:
 * - Executing `getStaticPaths` when present
 * - Rendering server components and caching their HTML output
 * - Generating client component JS modules when needed
 *
 * Server-rendered components take precedence over client components.
 *
 * @async
 * @param {string} filePath
 * Absolute path to the component or page HTML file.
 *
 * @returns {Promise<"Server component generated" | "Client component generated">}
 * Indicates which type of artifact was generated.
 */
/**
 * Tracks which component files have already been processed during the current
 * build run
 *
 * Shared components (e.g. `UserCard`) are imported by multiple pages, so
 * `generateComponentAndFillCache` could be invoked for the same file path
 * dozens of times — once per page that imports it. Without this guard every
 * invocation would re-run `generateServerComponentHTML`, write the same files
 * to disk multiple times, and schedule redundant recursive calls for that
 * component's own dependencies.
 *
 * The Set is cleared at the start of `generateComponentsAndFillCache` so that
 * a second build run (e.g. hot-reload) starts with a clean slate.
 */
const processedComponentsInBuild = new Set();

async function generateComponentAndFillCache(filePath) {
  if (processedComponentsInBuild.has(filePath)) return 'Already processed';
  processedComponentsInBuild.add(filePath);

  const urlPath = getRoutePath(filePath);

  const {
    template,
    htmls: serverHtmls,
    canCSR,
    clientImports,
    metadata,
    clientCode,
    clientComponents,
    serverComponents,
  } = await generateServerComponentHTML(filePath);
  
  const saveServerHtmlsPromises = [];
  const saveClientHtmlPromises = [];
  const saveComponentsPromises = [];
  
  if (serverHtmls.length) {
    for (const { params, html, pageHtml, metadata: pageMetadata } of serverHtmls) {
      const cacheKey = fillRoute(urlPath, params);
      saveServerHtmlsPromises.push(saveComponentHtmlDisk({ componentPath: cacheKey, html }));

      if (canCSR) {
        saveServerHtmlsPromises.push(saveClientComponent({
          metadata: pageMetadata,
          clientCode,
          template: pageHtml,
          clientImports,
          clientComponents,
          componentName: generateComponentId(cacheKey),
          componentFilePath: filePath,
        }))
      }
    }
  }

  if (canCSR && serverHtmls.length === 0) {
    saveClientHtmlPromises.push(saveClientComponent({
      metadata,
      clientCode,
      template,
      clientImports,
      clientComponents,
      componentName: generateComponentId(urlPath),
      componentFilePath: filePath,
    }))
  }

  if(serverComponents.size > 0) {
    const serverComponentPaths = Array.from(serverComponents.values()).map(({ path }) => path);
    saveComponentsPromises.push(...serverComponentPaths.map(generateComponentAndFillCache));
  }

  if(clientComponents.size > 0) {
    const clientComponentPaths = Array.from(clientComponents.values()).map(({ path }) => path);
    saveComponentsPromises.push(...clientComponentPaths.map(generateComponentAndFillCache));
  }
  
  await Promise.all([...saveServerHtmlsPromises, ...saveClientHtmlPromises, ...saveComponentsPromises]);

  return 'Component generated';
}

/**
 * Generates all application components and fills the server HTML cache.
 *
 * This function:
 * - Scans all pages and reusable components
 * - Generates server-rendered HTML when possible
 * - Generates client-side component modules when required
 * - Persists outputs to disk for runtime usage
 *
 * Intended to be executed at build-time or during pre-render steps.
 *
 * @async
 * @returns {Promise<string>}
 * Build completion message.
 */
export async function generateComponentsAndFillCache() {
  // Reset the deduplication set so repeated build runs start clean
  processedComponentsInBuild.clear();

  const pagesFiles = await getPageFiles({ layouts: true });

  const generateComponentsPromises = pagesFiles.map((file) =>
    generateComponentAndFillCache(file.fullpath)
  );

  await Promise.all(generateComponentsPromises);

  return 'Components generation completed';
}

/**
 * Extracts routing metadata from a page file and generates
 * server-side and client-side route definitions.
 *
 * Determines whether the page:
 * - Requires SSR
 * - Can be statically rendered
 * - Needs a client-side hydration component
 *
 * This function does NOT write files; it only prepares route descriptors.
 *
 * @async
 * @param {{
 *   fullpath: string,
 *   path: string
 * }} file
 * Page file descriptor.
 *
 * @returns {Promise<{
 *   serverRoutes: Array<{
 *     path: string,
 *     serverPath: string,
 *     isNotFound: boolean,
 *     meta: {
 *       ssr: boolean,
 *       requiresAuth: boolean,
 *       revalidate: number | string
 *     }
 *   }>,
 *   clientRoutes: Array<{
 *     path: string,
 *     component?: Function,
 *     meta: {
 *       ssr: boolean,
 *       requiresAuth: boolean,
 *     }
 *   }>,
 * }>}
 * Route configuration data used to generate routing files.
 */
async function getRouteFileData(file) {
  const data = {
    serverRoutes: [],
    clientRoutes: [],
  }

  const [ processedFileData, layoutPaths ]= await Promise.all([
    processHtmlFile(file.fullpath),
    getLayoutPaths(file.fullpath),
  ]);

  const { getData, getMetadata, getStaticPaths, serverComponents } = processedFileData;

  const filePath = getOriginalRoutePath(file.fullpath);
  const urlPath = getRoutePath(file.fullpath);

  const { metadata, paths } = await getMetadataAndStaticPaths(getMetadata, getStaticPaths);


  const canCSR = getIfPageCanCSR(
    metadata?.revalidate,
    serverComponents.size > 0,
    typeof getData === "function"
  );

  // Push a plain object — no serialisation needed.
  // Previously this was a hand-crafted JS string that generateRoutes() had to
  // eval() back into an object. Using a plain object lets saveServerRoutesFile
  // serialise with JSON.stringify and lets generateRoutes() return the array directly.
  data.serverRoutes.push({
    path: filePath,
    serverPath: urlPath,
    isNotFound: file.path.includes("/not-found/"),
    meta: {
      ssr: !canCSR,
      requiresAuth: false,
      revalidate: metadata?.revalidate ?? 0,
    },
  });


  if (!canCSR) {
    data.clientRoutes.push(`{
      path: "${urlPath}",
      meta: {
        ssr: true,
        requiresAuth: false,
      },
    }`);

    return data;
  }

  const componentsBasePath = "/_vexjs/_components";

  const layoutsImportData = layoutPaths.map((layoutPath) => {
    const urlPath = getRoutePath(layoutPath);
    const layoutComponentName = generateComponentId(urlPath);
    return ({
      name: layoutComponentName,
      importPath: `${componentsBasePath}/${layoutComponentName}.js`,
    })
  });

  // if is static page with paths, create route for each path
  if (paths.length > 0) {
    for (const pathObj of paths) {
      const filledPath = fillRoute(urlPath, pathObj.params);
      const componentName = generateComponentId(filledPath);
      const importPath = `${componentsBasePath}/${componentName}.js`;

      data.clientRoutes.push(`{
        path: "${filledPath}",
        component: async () => {
          const mod = await loadRouteComponent("${filledPath}", () => import("${importPath}"));

          return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
        },
        layouts: ${JSON.stringify(layoutsImportData)},
        meta: {
          ssr: false,
          requiresAuth: false,
        },
      }`);
    }
  } else {
    const componentName = generateComponentId(urlPath);
    const importPath = `${componentsBasePath}/${componentName}.js`;

    data.clientRoutes.push(`{
      path: "${urlPath}",
      component: async () => {
        const mod = await loadRouteComponent("${urlPath}", () => import("${importPath}"));
        
        return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
      },
      layouts: ${JSON.stringify(layoutsImportData)},
      meta: {
        ssr: false,
        requiresAuth: false,
      },
    }`);
  }

  return data;
}

/**
 * Generates server-side and client-side routing tables by scanning page files.
 *
 * This function:
 * - Analyzes each page to determine SSR or client rendering
 * - Produces server route definitions for request handling
 * - Produces client route definitions for navigation and hydration
 * - Writes routing artifacts to disk
 *
 * Output files:
 * - `server/_routes.js`
 * - `public/_routes.js`
 *
 * @async
 * @returns {Promise<{
 *   serverRoutes: Array<{
 *     path: string,
 *     serverPath: string,
 *     isNotFound: boolean,
 *     meta: {
 *       ssr: boolean,
 *       requiresAuth: boolean,
 *       revalidate: number | string
 *     }
 *   }>
 * }>}
 * Parsed server routes for runtime usage.
 */
export async function generateRoutes() {
  const pageFiles = await getPageFiles()

  const serverRoutes = [];
  const clientRoutes = [];

  const routeFilesPromises = pageFiles.map((pageFile) => getRouteFileData(pageFile))
  const routeFiles = await Promise.all(routeFilesPromises);

  for (const routeFile of routeFiles) {
    const {
      serverRoutes: serverRoutesFile,
      clientRoutes: clientRoutesFile,
    } = routeFile;

    if (serverRoutesFile?.length) {
      serverRoutes.push(...serverRoutesFile);
    }
    if (clientRoutesFile?.length) {
      clientRoutes.push(...clientRoutesFile);
    }
  }

  await Promise.all([
    saveClientRoutesFile(clientRoutes),
    saveServerRoutesFile(serverRoutes),
  ]);

  // serverRoutes is already an array of plain objects — no eval() needed (BUILD-03 fix)
  return { serverRoutes };
}

/**
 * Bundles a single user JS file with esbuild so npm bare-specifier imports
 * are resolved and inlined, while vex/*, @/*, and relative user imports stay
 * external (singletons served at /_vexjs/user/*).
 *
 * Output is written to USER_GENERATED_DIR preserving the SRC_DIR-relative path.
 *
 * @param {string} filePath - Absolute path to the user .js file.
 */
async function buildUserFile(filePath) {
  const rel = path.relative(SRC_DIR, filePath).replace(/\\/g, "/");
  const outfile = path.join(USER_GENERATED_DIR, rel);
  await esbuild.build({
    entryPoints: [filePath],
    bundle: true,
    format: "esm",
    outfile,
    plugins: [createVexAliasPlugin()],
    minify: process.env.NODE_ENV === "production",
  });
}

/**
 * Recursively finds all .js files in SRC_DIR (excluding WATCH_IGNORE dirs)
 * and prebundles each one via buildUserFile.
 *
 * Called during build() so that user utility files are ready before the server
 * starts serving /_vexjs/user/* from the pre-built static output.
 */
async function buildUserFiles() {
  const collect = async (dir) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      if (WATCH_IGNORE.has(entry.name)) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(full);
      } else if (entry.name.endsWith(".js")) {
        const rel = path.relative(SRC_DIR, full).replace(/\\/g, "/");
        if (WATCH_IGNORE_FILES.some(pattern => path.matchesGlob(rel, pattern))) return;
        try {
          await buildUserFile(full);
        } catch (e) {
          console.error(`[build] Failed to bundle user file ${full}:`, e.message);
        }
      }
    }));
  };
  await collect(SRC_DIR);
}

/**
 * Single-pass build entry point.
 *
 * Previously `prebuild.js` and `index.js` called `generateComponentsAndFillCache`
 * and `generateRoutes` as two independent steps. Both steps processed the same
 * page files: the first populated `processHtmlFileCache`, the second hit the
 * cache, but they were still two separate async chains.
 *
 * `build()` runs both steps sequentially and returns the server routes so
 * callers need only one import and one await.
 *
 * @async
 * @returns {Promise<{ serverRoutes: Array<Object> }>}
 */
export async function build() {
  await generateComponentsAndFillCache();
  await buildUserFiles();
  return generateRoutes();
}
