import { watch } from "fs";
import path from "path";
import { compileTemplateToHTML } from "./template.js";
import { getOriginalRoutePath, getPageFiles, getRoutePath, saveClientComponentModule, saveClientRoutesFile, saveComponentHtmlDisk, saveServerRoutesFile, readFile, getImportData, generateComponentId, adjustClientModulePath, PAGES_DIR, ROOT_HTML_DIR, getLayoutPaths } from "./files.js";
import { renderComponents } from "./streaming.js";
import { getRevalidateSeconds } from "./cache.js";

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
  const watchDirs = [PAGES_DIR, path.join(path.dirname(PAGES_DIR), "components")];
  for (const dir of watchDirs) {
    watch(dir, { recursive: true }, (_, filename) => {
      if (filename?.endsWith(".html")) {
        const fullPath = path.join(dir, filename);
        processHtmlFileCache.delete(fullPath);
      }
    });
  }

  // root.html is a single file — watch it directly
  watch(ROOT_HTML_DIR, async () => {
    rootTemplate = await readFile(ROOT_HTML_DIR);
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
const getScriptImports = async (script, isClientSide = false) => {
  const componentRegistry = new Map();
  const imports = {};
  const clientImports = {};
  const importRegex =
    /import\s+(?:([a-zA-Z_$][\w$]*)|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  // Process imports
  while ((match = importRegex.exec(script)) !== null) {
    const [importStatement, defaultImport, namedImports, modulePath] = match;

    const { path, fileUrl } = await getImportData(modulePath);

    if (path.endsWith(".html")) {
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
      const adjustedClientModule = adjustClientModulePath(modulePath, importStatement);
      clientImports[defaultImport || namedImports] = {
        fileUrl,
        originalPath: adjustedClientModule.path,
        importStatement: adjustedClientModule.importStatement,
      };
    } else {
      namedImports.split(",").forEach((name) => {
        const trimmedName = name.trim();
        // if import module path is .app/file_name.js add .app/client/services/file_name.js
      const adjustedClientModule = adjustClientModulePath(modulePath, importStatement);
        clientImports[trimmedName] = {
          fileUrl,      
          originalPath: adjustedClientModule.path,
          importStatement: adjustedClientModule.importStatement,
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
      const fn = new AsyncFunction(
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
        const result = await fn(...Object.values(imports));
        getData = result.getData;
        getStaticPaths = result.getStaticPaths;
        getMetadata = result.metadata ? () => result.metadata : result.getMetadata;
      } catch (error) {
        console.error(`Error executing script in ${filePath}:`, error.message);
      }
    }
  }

  if (clientMatch) {
    const { componentRegistry, clientImports: newClientImports } = await getScriptImports(clientMatch[1], true);
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
  clientComponentsScripts = [],
  clientComponents = new Map(),
}) {
  if (!clientCode) return "";
  // replace component imports to point to .js files
  for (const { importStatement } of clientComponents.values()) {
    clientCode = clientCode.replace(`${importStatement};`, '').replace(importStatement, "");
  }

  const clientCodeWithoutComponentImports = clientCode
    .split("\n")
    .filter((line) => !/^\s*import\s+.*['"].*\.html['"]/.test(line))
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

  // wrap in root — rootTemplate is pre-loaded at module level (see PERF-02)
  currentContent = compileTemplateToHTML(rootTemplate, {
    ...pageHead,
    metadata: deepMetadata,
    props: {
      children: currentContent
    }
  });

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
    serverComponents,
    clientComponents,
    suspenseComponents,
    clientComponentsScripts,
  } = await renderPage(pagePath, ctx, awaitSuspenseComponents);


  // Wrap in layout
  const clientScripts = generateClientScriptTags({
    clientCode,
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

  // v-for="item in items" → ${items.value.map(item => html`...`)}
  result = result.replace(
    /<(\w+)([^>]*)\s+v-for="(\w+)\s+in\s+([^"]+)(?:\.value)?"([^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, beforeAttrs, iterVar, arrayVar, afterAttrs, content) => {
      const cleanExpr = arrayVar.trim();
      const isSimpleVar = /^\w+$/.test(cleanExpr);
      const arrayAccess = isSimpleVar && reactiveVars.has(cleanExpr)
        ? `${cleanExpr}.value`
        : cleanExpr;
      return `\${${arrayAccess}.map(${iterVar} => html\`<${tag}${beforeAttrs}${afterAttrs}>${content}</${tag}>\`)}`;
    }
  );

  // v-show="condition" → v-show="${condition.value}" (add .value for reactive vars)
  result = result.replace(/v-show="([^"]+)"/g, (_, condition) => {
    return `v-show="\${${processExpression(condition)}}"`;
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

  // v-if="condition" → v-if="${condition}"
  result = result.replace(/v-if="([^"]*)"/g, 'v-if="${$1}"');

  // v-else-if="condition" → v-else-if="${condition}"
  result = result.replace(/v-else-if="([^"]*)"/g, 'v-else-if="${$1}"');

  return result;
}


/**
 * Normalizes and deduplicates client-side ES module imports,
 * ensuring required framework imports are present.
 *
 * @async
 * @param {Record<string, {
 *   fileUrl: string,
 *   originalPath: string,
 *   importStatement: string
 * }>} clientImports
 *
 * @param {Record<string, string[]>} [requiredImports]
 *
 * @returns {Promise<string[]>}
 * Clean import statements.
 */
async function getClientCodeImports(
  clientImports,
  requiredImports = {
    "/.app/client/services/reactive.js": ["effect"],
    "/.app/client/services/html.js": ["html"],
  }
) {

  // Create a unique set of import statements to avoid duplicates
  const cleanImportsSet = new Set(
    Object.values(clientImports).map((importData) => importData.importStatement)
  );
  const cleanImports = Array.from(cleanImportsSet);

  for (const [modulePath, requiredModules] of Object.entries(requiredImports)) {
    const importIndex = cleanImports.findIndex((imp) =>
      new RegExp(`from\\s+['"]${modulePath}['"]`).test(imp)
    );

    if (importIndex === -1) {
      cleanImports.push(
        `import { ${requiredModules.join(", ")} } from '${modulePath}';`
      );
    } else {
      // if import exists, ensure it includes all required symbols
      const existingImport = cleanImports[importIndex];
      const importMatch = existingImport.match(/\{([^}]+)\}/);

      if (importMatch) {
        const importedModules = importMatch[1].split(",").map((s) => s.trim());
        // Determine which required modules are missing
        const missingModules = requiredModules.filter(
          (s) => !importedModules.includes(s)
        );
        if (missingModules.length > 0) {
          // Add missing symbols and reconstruct the import statement
          importedModules.push(...missingModules);
          cleanImports[importIndex] = existingImport.replace(
            /\{[^}]+\}/,
            `{ ${importedModules.join(", ")} }`
          );
        }
      } else {
        // If no named imports, convert to named imports
        cleanImports[importIndex] = `import { ${requiredModules.join(
          ", "
        )} } from '${modulePath}';`;
      }
    }
  }

  // Return the final list of import statements
  return cleanImports;
}

/**
 * Generates a client-side JS module for a hydrated component.
 *
 * The module:
 * - Includes required imports
 * - Injects default props
 * - Exports metadata
 * - Exposes a hydration entry point
 *
 * @async
 * @param {string} clientCode
 * @param {string} template
 * @param {object} metadata
 * @param {Record<string, {
 *  fileUrl: string,
 *  originalPath: string,
 *  importStatement: string
 *  }>} clientImports
 * 
 *
 * @returns {Promise<string|null>}
 * Generated JS module code or null if no client code exists.
 */
export async function generateClientComponentModule({
  clientCode,
  template,
  metadata,
  clientImports,
  clientComponents,
}) {

  // Extract default props from vprops
  const defaults = extractVPropsDefaults(clientCode);

  const clientCodeWithProps = addComputedProps(clientCode, defaults);

  // Remove vprops declaration and imports from client code
  const cleanClientCode = clientCodeWithProps
    .replace(/const\s+props\s*=\s*vprops\s*\([\s\S]*?\)\s*;?/g, "")
    .replace(/^\s*import\s+.*$/gm, "")
    .trim();

  // Convert template
  const convertedTemplate = convertVueToHtmlTagged(template, clientCodeWithProps);

  const { html: processedHtml } = await renderComponents({
    html: convertedTemplate,
    clientComponents,
  });

  const cleanImports = await getClientCodeImports(clientImports);

  const clientComponentModule = `
    ${cleanImports.join("\n")}  

    export const metadata = ${JSON.stringify(metadata)}
    
    export function hydrateClientComponent(marker, incomingProps = {}) {
      ${cleanClientCode}
      
      let root = null;
      function render() {
        const node = html\`${processedHtml}\`;
        if (!root) {
          root = node;
          marker.replaceWith(node);
        } else {
          root.replaceWith(node);
          root = node;
        }
      }

      effect(() => render());

      return root;
    }
  `;

  return clientComponentModule.trim();
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
 * @param {string} originalPath - The original file path of the component.
 * @param {Record<string, any>} [props={}] - An object of props to pass to the component.
 *                                            Values can be literals or template
 *                                            interpolations (`${…}`) for dynamic evaluation.
 *
 * @returns {Promise<string>} A promise that resolves to a string containing
 *                            the `<template>` HTML for hydration.
 */
export async function processClientComponent(componentName, originalPath, props = {}) {
  const targetId = `client-${componentName}-${Date.now()}`;

  const propsEntries = Object.entries(props)
    .map(([key, value]) => {
      // if starts with ${ remove quotes
      if (typeof value === "string" && value.startsWith("${")) {
        return `${key}:${value.replace(/^\$\{|\}$/g, "")}`;
      } else {
        return `${key}:${JSON.stringify(value)}`;
      }
    })
    .join(",");

  const componentImport = generateComponentId(originalPath)
  const html = `<template id="${targetId}" data-client:component="${componentImport}" data-client:props='${propsEntries ? `\${JSON.stringify({${propsEntries}})}` : "{}"}'></template>`;
  
  return html;
}

/**
 * Extract vprops object literal from client code
 * @param {string} clientCode
 * @returns {string | null}
 */
function extractVPropsObject(clientCode) {
  const match = clientCode.match(/vprops\s*\(\s*(\{[\s\S]*?\})\s*\)/);
  return match ? match[1] : null;
}

/**
 * Extract default values from vprops definition
 * @param {string} clientCode
 * @returns {object} Object with prop names and their default values
 */
function extractVPropsDefaults(clientCode) {
  const vpropsLiteral = extractVPropsObject(clientCode);
  if (!vpropsLiteral) return {};

  const vpropsDef = safeObjectEval(vpropsLiteral);
  const defaults = {};

  for (const key in vpropsDef) {
    const def = vpropsDef[key];
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
 * Applies default props from vprops definition
 * @param {object} vpropsDef
 * @param {object} componentProps
 * @returns {object}
 */
function applyDefaultProps(vpropsDefined, componentProps) {
  const finalProps = {};
  for (const key in vpropsDefined) {
    const def = vpropsDefined[key];
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
  const vpropsLiteral = extractVPropsObject(clientCode);

  if (!vpropsLiteral) return componentProps;

  const vpropsDefined = safeObjectEval(vpropsLiteral);

  return applyDefaultProps(vpropsDefined, componentProps);
}

/**
 * Adds computed props to client code if are defined.
 * Replaces vprops(...) by const props = { ... };
 * @param {string} clientCode
 * @param {object} componentProps
 * 
 * @returns {string}
 */
function addComputedProps(clientCode, componentProps) {
  const vpropsRegex = /const\s+props\s*=\s*vprops\s*\([\s\S]*?\)\s*;?/;
  if (!vpropsRegex.test(clientCode)) return clientCode;

  const computedProps = computeProps(clientCode, componentProps);

  return clientCode.replace(
    vpropsRegex,
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
 * 
 * Generates js module and save it in public directory.
 * 
 * @param {{
 *  metadata: object,
 *  clientCode: string,
 *  template: string,
 *  clientImports: Record<string, {
 *    fileUrl: string,
 *    originalPath: string,
 *    importStatement: string
 * }>,
 *  clientComponents: Record<string, any>,
 *  componentName: string,
 * }} 
 * 
 * @returns {Promise<void>}
 */
async function saveClientComponent({
  metadata,
  clientCode,
  template,
  clientImports,
  clientComponents,
  componentName,
}) {
  const jsModuleCode = await generateClientComponentModule({
    metadata,
    clientCode,
    template,
    clientImports,
    clientComponents,
  });

  if (jsModuleCode) {
    await saveClientComponentModule(componentName, jsModuleCode)
  }
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
async function generateComponentAndFillCache(filePath) {
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

  data.serverRoutes.push(`{
    path: "${filePath}",
    serverPath: "${urlPath}",
    isNotFound: ${file.path.includes("/not-found/")},
    meta: {
      ssr: ${!canCSR},
      requiresAuth: false,
      revalidate: "${metadata?.revalidate ?? 0}" ,
    },
  }`);


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

  const componentsBasePath = "/.app/client/_components";

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

  return {
    serverRoutes: serverRoutes.map(r => eval(`(${r})`)),
  };
}
