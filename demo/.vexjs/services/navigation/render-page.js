import { addMetadata } from "./metadata.js";

/**
 * Renders a client-side page component into the DOM, wrapping it with layouts if defined.
 *
 * This function performs the following steps:
 * - Dynamically imports the route component.
 * - Hydrates the component into a DOM node.
 * - Wraps the page node with layouts using the provided `layoutRenderer`.
 * - Patches the layout if it already exists, or replaces the root content.
 * - Updates page metadata (title, description).
 * - Hydrates any client-side components within the page.
 *
 * @param {Object} options - The rendering options.
 * @param {import('../_routes.js').Route} options.route - The route object containing the component and layout info.
 * @param {import('./create-layouts.js').LayoutRenderer} options.layoutRenderer - The layout renderer instance responsible for wrapping layouts.
 *
 * @returns {Promise<void>} Resolves when the page has been rendered and layouts patched.
 */
export async function renderPage({ route, layoutRenderer }) {
  if (!route?.component) return;

  const mod = await route.component();
  if (!mod.hydrateClientComponent) return;

  const root = document.getElementById("app-root") || document.body;
  const marker = document.createElement("template");
  const pageNode = mod.hydrateClientComponent(marker);

  const { node, layoutId, metadata } = await layoutRenderer.generate({
    routeLayouts: route.layouts,
    pageNode,
    metadata: mod.metadata,
  });

  if (layoutId) {
    layoutRenderer.patch(layoutId, node);
  } else {
    root.innerHTML = "";
    root.appendChild(node);
  }

  if (metadata) addMetadata(metadata);
  hydrateComponents();
}
