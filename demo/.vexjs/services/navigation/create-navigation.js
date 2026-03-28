import { setupLinkInterceptor } from "./link-interceptor.js";
import { setupPrefetchObserver } from "./prefetch.js";
import { navigateInternal } from "./navigate.js";
import { findRouteWithParams } from "./router.js";
import { createLayoutRenderer } from "./create-layouts.js";

/**
 * Creates a new SPA navigation runtime with encapsulated state.
 *
 * This factory returns a navigation runtime that manages:
 * - Current navigation controller (for aborting in-progress navigations)
 * - Layout rendering via `layoutRenderer`
 * - Link interception for SPA navigation
 * - Prefetch observer setup
 * - Popstate handling for back/forward browser navigation
 *
 * Each instance is isolated and maintains its own state, making it safe
 * to use multiple runtimes or for testing purposes.
 *
 * @returns {Object} The navigation runtime API.
 * @property {(path: string, addToHistory?: boolean) => Promise<void>} navigate - Programmatically navigate to a given path.
 * @property {() => void} initialize - Initializes the SPA router and sets up link interception, prefetching, and initial navigation.
 */
export function createNavigationRuntime() {
  /** @type {AbortController | null} - Controller for the current navigation request */
  let currentNavigationController = null;

  /** Layout renderer instance for wrapping pages with layouts */
  const layoutRenderer = createLayoutRenderer();

  /**
   * Aborts the currently active navigation, if any.
   * @private
   */
  function abortPrevious() {
    if (currentNavigationController) {
      currentNavigationController.abort();
    }
  }

  /**
   * Performs SPA navigation to the specified path.
   *
   * Aborts any in-progress navigation, manages history state, and renders
   * the target route. Handles SSR routes and layout rendering internally.
   *
   * @param {string} path - The URL path to navigate to.
   * @param {boolean} [addToHistory=true] - Whether to push this navigation to the browser history.
   * @returns {Promise<void>} Resolves when navigation is complete.
   */
  async function navigate(path, addToHistory = true) {
    abortPrevious();

    const controller = new AbortController();
    currentNavigationController = controller;

    try {
      await navigateInternal({
        path,
        addToHistory,
        controller,
        layoutRenderer,
        onFinish: () => {
          if (currentNavigationController === controller) {
            currentNavigationController = null;
          }
        },
      });
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("Navigation error:", e);
      }
    }
  }

  /**
   * Initializes the SPA router.
   *
   * Sets up:
   * - Popstate listener for browser back/forward navigation
   * - Link interception for SPA navigation
   * - Prefetch observer for internal links
   * - Initial navigation if the current route is not SSR
   *
   * Must be called after DOMContentLoaded.
   */
  function initialize() {
    window.addEventListener("popstate", () => {
      navigate(location.pathname, false);
    });

    setupLinkInterceptor(navigate);
    setupPrefetchObserver();
    layoutRenderer.reset();

    const { route } = findRouteWithParams(location.pathname);
    if (!route?.meta?.ssr) {
      navigate(location.pathname, false);
    }
  }

  return { navigate, initialize };
}
