import { findRouteWithParams } from "./router.js";
import { routes } from "../_routes.js";
import { updateRouteParams } from "./use-route-params.js";
import { renderPage } from "./render-page.js";
import { renderSSRPage } from "./render-ssr.js";

/**
 * Handles the internal SPA navigation logic.
 *
 * This function performs the following tasks:
 * - Updates the route parameters store.
 * - Updates browser history (if `addToHistory` is true).
 * - Resolves the target route using the router.
 * - Handles SSR routes by fetching and rendering via streaming.
 * - Checks authentication and access restrictions, redirecting if necessary.
 * - Renders the target page component and its layouts.
 * - Calls `onFinish` when navigation is complete, regardless of success or error.
 *
 * @param {Object} options - Navigation options.
 * @param {string} options.path - The target URL path for navigation.
 * @param {boolean} options.addToHistory - Whether to push this navigation to browser history.
 * @param {AbortController} options.controller - The controller used to cancel the navigation if needed.
 * @param {import('./create-layouts.js').LayoutRenderer} options.layoutRenderer - Instance responsible for rendering layouts.
 * @param {() => void} options.onFinish - Callback invoked when navigation completes or is aborted.
 *
 * @returns {Promise<void>} Resolves when navigation is complete.
 */
export async function navigateInternal({
  path,
  addToHistory,
  controller,
  layoutRenderer,
  onFinish,
}) {
  updateRouteParams(path);

  const routePath = path.split("?")[0];
  const { route: matchedRoute } = findRouteWithParams(routePath);
  const route = matchedRoute ?? routes.find((r) => r.isNotFound) ?? null;

  if (addToHistory) {
    history.pushState({}, "", path);
  }

  try {
    if (route?.meta?.ssr) {
      layoutRenderer.reset();
      await renderSSRPage(path, controller.signal);
      return;
    }

    if (route?.meta?.requiresAuth && !app.Store?.loggedIn) {
      location.href = "/account/login";
      return;
    }

    if (route?.meta?.guestOnly && app.Store?.loggedIn) {
      location.href = "/account";
      return;
    }

    await renderPage({ route, layoutRenderer });
  } finally {
    onFinish();
  }
}
