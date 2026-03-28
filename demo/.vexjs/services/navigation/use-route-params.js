import { reactive } from "../reactive.js";
import { routes } from "../_routes.js";

/**
 * Reactive store holding the current route params.
 * This object is updated whenever the URL changes.
 */
const routeParams = reactive({});

/**
 * Extracts dynamic parameters from a pathname based on route definitions.
 *
 * Supported syntax:
 *   /posts/:id
 *   /users/:userId/:postId
 *
 * @param {string} pathname - URL pathname (no query, no hash)
 * @returns {Object} Extracted params
 */
function extractParams(pathname) {
  const pathParts = pathname.split("/").filter(Boolean);

  for (const route of routes) {
    const routeParts = route.path.split("/").filter(Boolean);
    if (routeParts.length !== pathParts.length) continue;

    const params = {};
    let match = true;

    for (let i = 0; i < routeParts.length; i++) {
      const routePart = routeParts[i];
      const pathPart = pathParts[i];

      if (routePart.startsWith(":")) {
        params[routePart.slice(1)] = pathPart;
      } else if (routePart !== pathPart) {
        match = false;
        break;
      }
    }

    if (match) return params;
  }

  return {};
}

/**
 * Updates the reactive route params based on the current URL.
 * @param {string} [path=window.location.pathname] - URL pathname to extract params from
 * @example
 * updateRouteParams(); // Updates params from current URL
 * updateRouteParams("/posts/42"); // Updates params from given path
 */
export function updateRouteParams(path = window.location.pathname) {
  const newParams = extractParams(path);

  Object.keys(routeParams).forEach((k) => delete routeParams[k]);
  Object.assign(routeParams, newParams);
}

/**
 * Composition function returning reactive route params.
 *
 * @returns {Object} Reactive route params
 *
 * @example
 * const params = useRouteParams();
 *
 * effect(() => {
 *   console.log(params.id);
 * });
 */
export function useRouteParams() {
  return routeParams;
}
