/**
 * @typedef {Object} Layout
 * @property {string} name - Layout name.
 * @property {string} importPath - Path to the module.
 */

/**
 * @typedef {Object} RenderedLayout
 * @property {string} name - Layout name.
 * @property {Node} children - Original children node.
 * @property {Node} node - Rendered layout node.
 */

/**
 * @typedef {Object} GenerateParams
 * @property {Layout[]} [routeLayouts] - Layouts to render for this route.
 * @property {Node} pageNode - The page node to wrap.
 * @property {any} metadata - Metadata for the page/layout.
 */

/**
 * @typedef {Object} GenerateResult
 * @property {string | null} layoutId - ID of the nearest rendered layout.
 * @property {Node} node - The root node after layout wrapping.
 * @property {any} metadata - Metadata after merging layouts.
 */

/**
 * Creates a layout renderer responsible for dynamically loading,
 * rendering, caching, and patching route-based layouts.
 *
 * The renderer keeps track of already rendered layouts to avoid
 * unnecessary re-renders and supports incremental layout updates.
 *
 * @returns {{
 *   generate: (params: GenerateParams) => Promise<GenerateResult>,
 *   patch: (layoutId: string, node: Node) => void,
 *   reset: () => void
 * }}
 */
export function createLayoutRenderer() {
  /** @type {Map<string, RenderedLayout>} */
  const renderedLayouts = new Map();

  /**
   * Removes cached layouts that are no longer part of the current route.
   * @param {Layout[]} routeLayouts
   */
  function cleanNotNeeded(routeLayouts) {
    for (const name of renderedLayouts.keys()) {
      const exists = routeLayouts.some((l) => l.name === name);
      if (!exists) {
        renderedLayouts.delete(name);
      }
    }
  }

  /**
   * Finds the nearest already-rendered layout in the route hierarchy.
   * @param {Layout[]} routeLayouts
   * @returns {RenderedLayout | null}
   */
  function getNearestRendered(routeLayouts) {
    const reversed = routeLayouts.toReversed();

    for (const layout of reversed) {
      if (renderedLayouts.has(layout.name)) {
        return renderedLayouts.get(layout.name);
      }
    }

    return null;
  }

  /**
   * Determines which layouts need to be rendered based on
   * the nearest cached layout.
   * @param {Layout[]} routeLayouts
   * @param {RenderedLayout | null} nearestRendered
   * @returns {Layout[]}
   */
  function getLayoutsToRender(routeLayouts, nearestRendered) {
    if (!nearestRendered) return routeLayouts;

    const reversed = routeLayouts.toReversed();
    const idx = reversed.findIndex((l) => l.name === nearestRendered.name);

    return idx === -1 ? routeLayouts : reversed.slice(0, idx);
  }

  /**
   * Dynamically imports layout modules.
   * @param {Layout[]} layouts
   * @returns {Promise<any[]>}
   */
  async function loadLayoutModules(layouts) {
    return Promise.all(layouts.map((layout) => import(layout.importPath)));
  }

  /**
   * Generates the layout tree wrapping the provided page node.
   * @param {GenerateParams} params
   * @returns {Promise<GenerateResult>}
   */
  async function generate({ routeLayouts = [], pageNode, metadata }) {
    if (!pageNode || routeLayouts.length === 0) {
      return {
        layoutId: null,
        node: pageNode,
        metadata,
      };
    }

    cleanNotNeeded(routeLayouts);

    const nearestRendered = getNearestRendered(routeLayouts);
    const layoutsToRender = getLayoutsToRender(routeLayouts, nearestRendered);

    const modules = await loadLayoutModules(layoutsToRender);

    let htmlContainerNode = pageNode;
    let deepestMetadata = metadata;

    for (let i = modules.length - 1; i >= 0; i--) {
      const layout = layoutsToRender[i];
      const mod = modules[i];

      // Wrap children in a stable vex-root container so that when the layout
      // re-renders due to reactive dependencies, props.children always points
      // to the same node. patch() updates the container's content instead of
      // replacing the node, so re-renders never restore stale page content.
      const childrenWrapper = document.createElement("vex-root");
      childrenWrapper.appendChild(htmlContainerNode);

      const marker = document.createElement("template");
      htmlContainerNode = mod.hydrateClientComponent(marker, { children: childrenWrapper });

      if (!deepestMetadata && mod.metadata) {
        deepestMetadata = mod.metadata;
      }

      renderedLayouts.set(layout.name, {
        name: layout.name,
        children: childrenWrapper,
        node: htmlContainerNode,
      });
    }

    return {
      layoutId: nearestRendered?.name ?? null,
      node: htmlContainerNode,
      metadata: deepestMetadata,
    };
  }

  /**
   * Patches an already-rendered layout by replacing its children node.
   * @param {string} layoutId
   * @param {Node} node
   */
  function patch(layoutId, node) {
    const record = renderedLayouts.get(layoutId);
    if (!record) return;

    // childrenWrapper is a stable vex-root node that stays in the DOM.
    // Replacing its children updates the page content without the layout
    // needing to re-render or props.children becoming stale.
    record.children.replaceChildren(node);
  }

  /**
   * Clears all cached rendered layouts.
   */
  function reset() {
    renderedLayouts.clear();
  }

  return { generate, patch, reset };
}
