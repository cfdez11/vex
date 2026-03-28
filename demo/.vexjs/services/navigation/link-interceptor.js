/**
 * Sets up a global click listener to intercept internal link clicks
 * and enable SPA-style navigation without full page reloads.
 *
 * This function ignores links that:
 * - Are external (different origin)
 * - Have `target="_blank"` or `rel="external"`
 * - Have a `data-reload` attribute
 * - Are hash links (start with "#")
 *
 * When a valid internal link is clicked, it prevents the default browser behavior
 * and invokes the provided `navigate` function with the link's path.
 *
 * @param {(path: string) => void} navigate - A function to handle navigation
 *   to the given path (e.g., your SPA router's `navigate` method).
 */
export function setupLinkInterceptor(navigate) {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    const url = new URL(href, window.location.origin);

    if (
      url.origin !== window.location.origin ||
      link.dataset.reload !== undefined ||
      link.target === "_blank" ||
      link.rel === "external"
    ) {
      return;
    }

    event.preventDefault();
    navigate(url.pathname);
  });
}
