/**
 * Client-side hydration helper for streaming Suspense boundaries.
 *
 * Previously this script was injected as a separate <script src="hydrate.js">
 * tag for every Suspense boundary on the page. The browser cached the file after
 * the first load, but still had to parse and initialise a new script execution
 * context for each tag — O(N) work per page with N Suspense boundaries.
 *
 * Now the script is loaded exactly once from root.html and exposes
 * `window.hydrateTarget(targetId, sourceId)`. Each Suspense replacement payload
 * calls that global function via a tiny inline script instead of loading this
 * file again.
 *
 * @param {string} targetId  - ID of the fallback <div> to replace.
 * @param {string} sourceId  - ID of the <template> containing the real content.
 */
window.hydrateTarget = function (targetId, sourceId) {
  const target = document.getElementById(targetId);
  const template = document.getElementById(sourceId);

  if (target && template) {
    target.replaceWith(template.content.cloneNode(true));
    template.remove();
  }
};
