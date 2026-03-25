import {
  processClientComponent,
  renderHtmlFile,
} from "./component-processor.js";


/**
 * Parses a string of raw HTML-like attributes into a structured object.
 * Return object will be used to pass props to components through template
 *
 * Supports:
 *   - Dynamic props with `:` prefix (e.g., `:prop="value"`).
 *   - Event handlers with `@` prefix (e.g., `@click="handler"`).
 *   - Static attributes (e.g., `id="my-id"` or `class="my-class"`).
 *
 * @param {string} rawAttrs - The raw attribute string extracted from an element tag.
 *
 * @returns {Record<string, string>} An object mapping attribute names to their values.
 *                                   Dynamic props and event handlers retain their raw
 *                                   string representations (e.g., template expressions).
 *
 * @example
 * parseAttributes(':links="${links}" @click="handleClick" id="my-component"');
 * // Returns:
 * // {
 * //   links: '${links}',
 * //   click: 'handleClick',
 * //   id: 'my-component'
 * // }
 */
function parseAttributes(rawAttrs) {
  const attrs = {};
  const regex = /:(\w+)=['"]([^'"]+)['"]|@(\w+)=['"]([^'"]+)['"]|(\w+)=['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = regex.exec(rawAttrs)) !== null) {
    if (match[1]) {
      // Dynamic prop :prop
      attrs[match[1]] = match[2];
    } else if (match[3]) {
      // Event handler @event
      attrs[match[3]] = match[4];
    } else if (match[5]) {
      // Static prop
      attrs[match[5]] = match[6];
    }
  }

  return attrs;
}


/**
 * Renders components in HTML
 * @param {string} html
 * @param {Map<string, { path: string }>} serverComponents
 * @returns {Promise<string>}
 */
/**
 * Renders server component instances in parallel.
 *
 * Each component type found in `serverComponents` may appear multiple times in
 * the HTML (e.g. three `<UserCard>` tags). Previously they were rendered one by
 * one in a serial `for` loop, even though each instance is fully independent.
 *
 * Now, all instances of a given component are kicked off at the same time with
 * `Promise.all` and their results are applied in reverse-index order so that
 * string offsets stay valid (replacing from the end of the string backwards).
 *
 * @param {string} html
 * @param {Map<string, { path: string }>} serverComponents
 * @returns {Promise<string>}
 */
async function processServerComponents(html, serverComponents) {
  let processedHtml = html;

  for (const [componentName, componentData] of serverComponents.entries()) {
    const escapedName = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const componentRegex = new RegExp(
      `<${escapedName}(?![a-zA-Z0-9_-])\\s*([^>]*?)\\s*(?:\\/>|>\\s*<\\/${escapedName}(?![a-zA-Z0-9_-])>)`,
      "gi"
    );

    const replacements = [];
    let match;

    while ((match = componentRegex.exec(html)) !== null) {
      replacements.push({
        name: componentName,
        attrs: parseAttributes(match[1]),
        fullMatch: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    if (replacements.length === 0) continue;

    // Render all instances of this component concurrently, then apply results
    // from the end of the string backwards so earlier offsets stay valid.
    const rendered = await Promise.all(
      replacements.map(({ attrs }) => renderHtmlFile(componentData.path, attrs))
    );

    for (let i = replacements.length - 1; i >= 0; i--) {
      const { start, end } = replacements[i];
      processedHtml =
        processedHtml.slice(0, start) +
        rendered[i].html +
        processedHtml.slice(end);
    }
  }

  return processedHtml;
}

/**
 * Renders components in HTML and client scripts to load them
 * @param {string} html
 * @param {Map<string, { path: string }>} clientComponents
 * @returns {Promise<{
 *  html: string,
 *  allScripts: Array<string>,
 * }>}
 */
async function renderClientComponents(html, clientComponents) {
  let processedHtml = html;
  const allMatches = [];
  const allScripts = [];

  for (const [componentName, { originalPath }] of clientComponents.entries()) {
    const escapedName = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const componentRegex = new RegExp(
      `<${escapedName}\\b((?:\\s+(?:[^\\s>"'=]+(?:=(?:"[^"]*"|'[^']*'|[^\\s"'=<>]+))?))*?)\\s*\\/?>`,
      "gi"
    );
    
    const replacements = [];
    let match;
    const htmlToProcess = processedHtml;

    while ((match = componentRegex.exec(htmlToProcess)) !== null) {
      const matchData = {
        name: componentName,
        attrs: parseAttributes(match[1]),
        fullMatch: match[0],
        start: match.index,
        end: match.index + match[0].length,
      };

      replacements.push(matchData);
      allMatches.push(matchData);
    }

    // Render in reverse order to maintain indices
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { start, end, attrs } = replacements[i];

      const htmlComponent = await processClientComponent(componentName, originalPath, attrs);

      processedHtml =
        processedHtml.slice(0, start) +
        htmlComponent +
        processedHtml.slice(end);
    }
  }

  return { html: processedHtml, allScripts };
}

/**
 * Renders server components, handling both regular and suspense boundaries
 * Server components without suspense are rendered immediately.
 * Server components inside <Suspense> boundaries are saved in suspenseComponents.
 * @param {string} pageHtml
 * @param {Map<string, { path: string }>} serverComponents
 * @param {boolean} awaitSuspenseComponents - If true, renders suspense components immediately
 * @returns {Promise<{
 *   html: string,
 *   suspenseComponents: Array<{
 *     id: string,
 *     content: string,
 *   }>
 * }>}
 */
async function renderServerComponents(pageHtml, serverComponents = new Map(), awaitSuspenseComponents = false) {
  const suspenseComponents = [];
  let suspenseId = 0;
  let html = pageHtml;

  // Fresh regex per call — avoids the shared-lastIndex race condition.
  // Each request gets its own regex instance with lastIndex starting at 0.
  const suspenseRegex = /<Suspense\s+fallback="([^"]*)">([\s\S]*?)<\/Suspense>/g;

  let match;
  while ((match = suspenseRegex.exec(html)) !== null) {
    const id = `suspense-${suspenseId++}`;
    const [fullMatch, fallback, content] = match;

    const suspenseContent = awaitSuspenseComponents ? content : fallback;

    // Render components in fallback if not awaiting suspense or in content if awaiting suspense
    const fallbackHtml = await processServerComponents(
      suspenseContent,
      serverComponents
    );

    suspenseComponents.push({
      id,
      content: content,
    });

    // Replace suspense block with container and restart the search from the
    // beginning of the modified string (indices have shifted after the replace).
    const replacement = `<div id="${id}">${fallbackHtml}</div>`;
    html = html.replace(fullMatch, replacement);
    suspenseRegex.lastIndex = 0;
  }

  // Render all non-suspended components
  html = await processServerComponents(html, serverComponents);

  return { html, suspenseComponents };
}

/**
 * Renders server components, client components in HTML, suspense components and client scripts to load client components
 * @param {{
 *  pageHtml: string,
 *  serverComponents: Map<string, { path: string, originalPath: string, importStatement: string }>,
 *  clientComponents: Map<string, { path: string, originalPath: string, importStatement: string }>,
 *  awaitSuspenseComponents: boolean,
 * }}
 * @returns {Promise<{
 *   html: string,
 *   clientComponentsScripts: Array<string>,
 *   suspenseComponents: Array<{
 *    id: string,
 *    content: string,
 *   }>
 * }>}
 */
export async function renderComponents({
  html,
  serverComponents = new Map(),
  clientComponents = new Map(),
  awaitSuspenseComponents = false,
}) {
  const hasServerComponents = serverComponents.size > 0;
  const hasClientComponents = clientComponents.size > 0;
  
  const { html: htmlServerComponents,  suspenseComponents } = hasServerComponents ? 
    await renderServerComponents(html, serverComponents, awaitSuspenseComponents) : 
    { 
      html, 
      suspenseComponents: [],
    };

  const { html: htmlClientComponents, allScripts: clientComponentsScripts } = 
    hasClientComponents ?
      await renderClientComponents(htmlServerComponents, clientComponents) :
      { 
        html: htmlServerComponents, 
        allScripts: [],
      };

  return {
    html: htmlClientComponents,
    suspenseComponents,
    clientComponentsScripts,
  };
}

/**
 * Generates the streaming HTML payload that replaces a Suspense fallback with
 * the real rendered content once it is ready.
 *
 * The payload consists of two parts streamed back-to-back:
 *  1. A `<template id="…">` holding the rendered HTML (invisible to the user).
 *  2. A tiny inline `<script>` that calls `window.hydrateTarget(targetId, sourceId)`.
 *
 * `window.hydrateTarget` is defined once in root.html via a single
 * `<script src="hydrate.js">`. Using an inline call instead of a per-boundary
 * `<script src="hydrate.js">` avoids the browser parsing and initialising the
 * same script N times.
 *
 * @param {string} suspenseId     - The id of the fallback <div> to replace.
 * @param {string} renderedContent - The real HTML to swap in.
 * @returns {string}
 */
export function generateReplacementContent(suspenseId, renderedContent) {
  const contentId = `${suspenseId}-content`;
  return `<template id="${contentId}">${renderedContent}</template><script>window.hydrateTarget("${suspenseId}","${contentId}")</script>`;
}

/**
 * Renders all components inside a suspense boundary
 * @param {{
 *   id: string,
 *   content: string,
 *   components: Array<{name: string, attrs: object, fullMatch: string}>
 * }} suspenseComponent
 * @param {Map<string, { path: string }>} serverComponents
 * @returns {Promise<string>}
 */
export async function renderSuspenseComponent(
  suspenseComponent,
  serverComponents
) {
  const html = await processServerComponents(
    suspenseComponent.content,
    serverComponents
  );

  return html;
}
