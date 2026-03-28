/**
 * Central cache for dynamically imported route components.
 * Stores already loaded modules to avoid repeated imports.
 */
const routeCache = new Map();

/**
 * Load a route component dynamically and cache it.
 *
 * @param {string} path - Unique path or key for the route module
 * @param {() => Promise<any>} importer - Function that imports the module
 * @returns {Promise<any>} - Resolves with the imported module
 */
export async function loadRouteComponent(path, importer) {
  if (routeCache.has(path)) {
    return routeCache.get(path);
  }

  const module = await importer();
  routeCache.set(path, module);
  return module;
}

/**
 * Prefetch a route component without rendering it.
 *
 * @param {string} path
 * @param {() => Promise<any>} importer
 */
export async function prefetchRouteComponent(path, importer) {
  try {
    await loadRouteComponent(path, importer);
  } catch (e) {
    console.error(`Prefetch failed for route ${path}:`, e);
  }
}

/**
 * Check if a route component is already loaded.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isRouteLoaded(path) {
  return routeCache.has(path);
}

/**
 * Clear cache (optional, e.g., for HMR or logout scenarios)
 */
export function clearRouteCache() {
  routeCache.clear();
}

export default routeCache;
