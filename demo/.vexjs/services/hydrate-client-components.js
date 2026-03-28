/**
 * Client-side component hydration script.
 *
 * This script automatically hydrates all components marked with
 * `data-client:component` in the DOM. It supports:
 *   - Initial hydration on page load
 *   - Progressive hydration for streaming SSR content
 *   - SPA updates by exposing a global `window.hydrateComponents` function
 *
 * Each component module is dynamically imported, and its exported
 * `hydrateClientComponent` function is called with the component marker.
 */
(function () {

  /**
   * Hydrates a single component marker.
   *
   * This function checks if the marker is already hydrated via the
   * `data-hydrated` attribute to avoid rehydration. It dynamically imports
   * the component module and calls its `hydrateClientComponent` function.
   *
   * @param {HTMLElement} marker - The <template> or marker element representing a client component.
   * @param {Object} [props={}] - Optional props to pass to the client component.
   */
  async function hydrateMarker(marker, props = {}) {
    if (marker.dataset.hydrated === "true") return;
    marker.dataset.hydrated = "true";

    const componentName = marker.getAttribute("data-client:component");
    const componentProps = marker.getAttribute("data-client:props");

    let parsedProps = {};
    try {
      parsedProps = JSON.parse(componentProps || "{}");
    } catch (e) {
      console.warn(`Failed to parse props for component ${componentName}`, e);
    }
    const finalProps = { ...parsedProps, ...props };

    try {
      const module = await import(`/_vexjs/_components/${componentName}.js`);
      await module.hydrateClientComponent(marker, finalProps);
    } catch (error) {
      console.error(`Failed to load component: ${componentName}`, error);
    }
  }

  /**
   * Hydrates all unhydrated component markers inside a container.
   *
   * @param {HTMLElement|Document} [container=document] - The root container to scan for components.
   */
  async function hydrateComponents(container = document, props = {}) {
    const markers = container.querySelectorAll(
      "[data-client\\:component]:not([data-hydrated='true'])"
    );

    for (const marker of markers) {
      await hydrateMarker(marker, props);
    }
  }

  /**
   * MutationObserver callback for progressive hydration.
   *
   * Observes DOM mutations and hydrates newly added components dynamically.
   */
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue; // Only element nodes
        if (node.matches?.("[data-client\\:component]")) hydrateMarker(node);
        hydrateComponents(node);
      }
    }
  });

  // Start observing the document for new nodes
  observer.observe(document, { childList: true, subtree: true });

  // Hydrate existing components on DOMContentLoaded or immediately if already interactive.
  // The observer is intentionally NOT disconnected here — it must stay active to catch
  // components inserted after DOMContentLoaded (nested CSR components, Suspense streaming,
  // SPA navigations). The `data-hydrated` guard in hydrateMarker prevents double-hydration.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrateComponents());
  } else {
    hydrateComponents();
  }

  /**
   * Expose `hydrateComponents` globally so it can be called manually
   * for SPA navigations or dynamically rendered content.
   * @type {function(HTMLElement|Document): Promise<void>}
   */
  window.hydrateComponents = hydrateComponents;
})();
