import { parseDocument, DomUtils } from "htmlparser2";
import { render } from "dom-serializer";

/**
 * Compiled-function cache.
 *
 * `Function(...keys, body)` compiles a new function object on every call.
 * With ~20 template expressions and 100 req/s that is ~2000 allocations/s
 * that the GC has to reclaim. The compiled function only depends on the
 * expression string and the names of the scope keys — not their values —
 * so it can be reused across requests by calling it with different arguments.
 *
 * Key format: `"<expression>::<key1>,<key2>,..."` — must include both the
 * expression and the key names because the same expression with a different
 * scope shape produces a different function signature.
 */
const fnCache = new Map();

/**
 * Evaluates a template expression against the provided data scope.
 *
 * The compiled `Function` is cached by expression + scope key names so it is
 * only created once per unique (expression, scope shape) pair.
 *
 * @param {string} expression
 * @param {object} scope
 * @returns {any}
 */
function getDataValue(expression, scope) {
  const keys = Object.keys(scope);
  const cacheKey = `${expression}::${keys.join(",")}`;
  if (!fnCache.has(cacheKey)) {
    fnCache.set(cacheKey, Function(...keys, `return (${expression})`));
  }
  try {
    return fnCache.get(cacheKey)(...Object.values(scope));
  } catch (e) {
    return "";
  }
}

/**
 * Checks if a DOM node is an empty text node
 * @param {ChildNode} node
 * @returns {boolean}
 */
function isEmptyTextNode(node) {
  return node.type === "text" && /^\s*$/.test(node.data);
}

/**
 * Parses HTML string and returns DOM nodes
 * @param {string} html
 * @returns {ChildNode[]}
 */
function parseHTMLToNodes(html) {
  try {
    const cleanHtml = html
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ +/g, " ")
      .trim();
    const dom = parseDocument(cleanHtml, { xmlMode: true });
    return DomUtils.getChildren(dom);
  } catch (error) {
    console.error('Error parsing HTML:', error);
    return [];
  }
}


/**
 * Processes an HTML file to extract script, template, metadata, client code, and component registry
 * @param {ChildNode} node
 * @param {Object} scope
 * @param {boolean} previousRendered
 * @returns {ChildNode | ChildNode[] | null}
 */
function processNode(node, scope, previousRendered = false) {
  if (node.type === "text") {
    node.data = node.data.replace(/\{\{(.+?)\}\}/g, (_, expr) =>
      getDataValue(expr.trim(), scope)
    );
    return node;
  }

  if (node.type === "tag") {
    const attrs = node.attribs || {};

    for (const [attrName, attrValue] of Object.entries(attrs)) {
      if (typeof attrValue === "string") {
        attrs[attrName] = attrValue.replace(/\{\{(.+?)\}\}/g, (_, expr) =>
          getDataValue(expr.trim(), scope)
        );
      }
    }

    if ("x-if" in attrs) {
      const show = getDataValue(attrs["x-if"], scope);
      delete attrs["x-if"];
      if (!show) return null;
    }

    if ("x-else-if" in attrs) {
      const show = getDataValue(attrs["x-else-if"], scope);
      delete attrs["x-else-if"];
      if (previousRendered || !show) return null;
    }

    if ("x-else" in attrs) {
      delete attrs["x-else"];
      if (previousRendered) {
        return null;
      }
    }

    if ("x-show" in attrs) {
      const show = getDataValue(attrs["x-show"], scope);
      delete attrs["x-show"];
      if (!show) {
        attrs.style = (attrs.style || "") + "display:none;";
      }
    }

    if ("x-for" in attrs) {
      const exp = attrs["x-for"];
      delete attrs["x-for"];

      // format: item in items
      const match = exp.match(/(.+?)\s+in\s+(.+)/);
      if (!match) throw new Error("Invalid x-for format: " + exp);

      const itemName = match[1].trim();
      const listExpr = match[2].trim();
      const list = getDataValue(listExpr, scope);

      if (!Array.isArray(list)) return null;

      const clones = [];

      for (const item of list) {
        const cloned = structuredClone(node);
        const newScope = { ...scope, [itemName]: item };
        clones.push(processNode(cloned, newScope));
      }

      return clones;
    }

    for (const [name, value] of Object.entries({ ...attrs })) {
      if (name.startsWith(":")) {
        const isSuspenseFallback =
          name === ":fallback" && node.name === "Suspense";
        const realName = name.slice(1);
        attrs[realName] = !isSuspenseFallback
          ? String(getDataValue(value, scope))
          : value;
        delete attrs[name];
      }

      if (name.startsWith("x-bind:")) {
        const realName = name.slice(7);
        attrs[realName] = String(getDataValue(value, scope));
        delete attrs[name];
      }
    }

    for (const [name] of Object.entries({ ...attrs })) {
      if (name.startsWith("@") || name.startsWith("x-on:")) {
        delete attrs[name];
      }
    }

    if (node.children) {
      const result = [];
      let isPreviousRendered = false;
      for (const child of node.children) {
        if (isEmptyTextNode(child)) {
          continue;
        }
        const processed = processNode(child, scope, isPreviousRendered);
        if (Array.isArray(processed)) {
          result.push(...processed);
          isPreviousRendered = processed.length > 0;
        } else if (processed) {
          result.push(processed);
          isPreviousRendered = true;
        } else {
          isPreviousRendered = false;
        }
      }
      node.children = result;
    }

    return node;
  }

  return node;
}

/**
 * Renders HTML template content with provided data
 * @param {string} templateContent
 * @param {{
 *  [name: string]: string,
 *  clientScripts?: string[],
 *  metadata?: {
 *    title?: string,
 *    description?: string,
 *  }
 * }} data
 * @returns {string}
 *
 */
/**
 * Parsed-template cache (PERF-05).
 *
 * `parseHTMLToNodes` runs `parseDocument` (htmlparser2) on every call, which
 * tokenises and builds a full DOM tree from the template string. The template
 * string is constant between requests — only `data` changes — so the resulting
 * tree can be cached and deep-cloned before each processing pass.
 *
 * `structuredClone` is used to deep-clone the cached nodes. htmlparser2 nodes
 * are plain objects (no functions / Symbols), so structuredClone handles them
 * correctly including the circular parent ↔ children references.
 *
 * Key:   raw template string
 * Value: array of parsed DOM nodes (never mutated — always clone before use)
 */
const parsedTemplateCache = new Map();

/**
 * Compiles a Vue-like HTML template string into a rendered HTML string.
 *
 * Parsing is performed only on the first call for a given template string.
 * Subsequent calls clone the cached node tree and process the clone directly,
 * avoiding repeated `parseDocument` invocations.
 *
 * @param {string} template
 * @param {{
 *  [name: string]: string,
 *  clientScripts?: string[],
 *  metadata?: { title?: string, description?: string }
 * }} data
 * @returns {string}
 */
export function compileTemplateToHTML(template, data = {}) {
  try {
    if (!parsedTemplateCache.has(template)) {
      parsedTemplateCache.set(template, parseHTMLToNodes(template));
    }
    // Clone before processing — processNode mutates the nodes in place
    const nodes = structuredClone(parsedTemplateCache.get(template));
    const processed = nodes
      .map((n) => processNode(n, data))
      .flat()
      .filter(Boolean);

    return render(processed, { encodeEntities: false });
  } catch (error) {
    console.error("Error compiling template:", error);
    throw error;
  }
}
