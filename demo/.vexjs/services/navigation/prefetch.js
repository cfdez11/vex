import { routes } from "../_routes.js";
import { prefetchRouteComponent } from "../cache.js";

/**
 * Sets up an IntersectionObserver to prefetch route components for links
 * with the `data-prefetch` attribute when they enter the viewport.
 *
 * Prefetched components are loaded in advance to improve SPA navigation performance.
 *
 * Links are only observed once, and the observer is disconnected for each link
 * after prefetching to avoid unnecessary observations.
 */
export function setupPrefetchObserver() {
  /** @type {IntersectionObserver} */
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        /** @type {HTMLAnchorElement} */
        const link = entry.target;
        if (!link.hasAttribute("data-prefetch")) return;

        const url = new URL(link.href, location.origin);
        const route = routes.find((r) => r.path === url.pathname);

        if (route?.component) {
          prefetchRouteComponent(route.path, route.component);
          observer.unobserve(link);
        }
      });
    },
    { rootMargin: "200px" }
  );

  // Observe all links with data-prefetch attribute that haven't been observed yet
  document.querySelectorAll("a[data-prefetch]").forEach((link) => {
    if (!link.__prefetchObserved) {
      link.__prefetchObserved = true;
      observer.observe(link);
    }
  });
}
