import { routes } from "../_routes.js";

/**
 * Converts a route path string with parameters (e.g., "/page/:city/:team")
 * into a RegExp for matching and extracts parameter keys.
 *
 * @param {string} routePath - The route path pattern.
 * @returns {{ regex: RegExp, keys: string[] }} An object containing the RegExp and parameter names.
 */
function pathToRegex(routePath) {
  const keys = [];
  const regex = new RegExp(
    "^" +
      routePath.replace(/:([^/]+)/g, (_, key) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "$"
  );
  return { regex, keys };
}

/**
 * Finds the first route matching a given path and extracts route parameters.
 *
 * Supports both string-based paths with parameters and RegExp-based paths.
 *
 * @param {string} path - The URL path to match (e.g., "/page/madrid/barcelona").
 * @returns {{ route: import('../_routes.js').Route | null, params: Record<string, string> }}
 *          Returns the matched route and an object of extracted parameters.
 */
export function findRouteWithParams(path) {
  for (const r of routes) {
    if (typeof r.path === "string") {
      const { regex, keys } = pathToRegex(r.path);
      const match = path.match(regex);
      if (match) {
        const params = {};
        keys.forEach((k, i) => (params[k] = match[i + 1]));
        return { route: r, params };
      }
    } else if (r.path instanceof RegExp && r.path.test(path)) {
      return { route: r, params: {} };
    }
  }

  return { route: null, params: {} };
}
