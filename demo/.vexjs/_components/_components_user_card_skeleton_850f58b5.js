// <stdin>
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm animate-pulse">
    <div class="flex items-center space-x-3">
      <div class="shrink-0">
        <div class="w-12 h-12 bg-gray-300 rounded-full"></div>
      </div>
      <div class="flex-1 space-y-2">
        <div class="h-4 bg-gray-300 rounded w-24"></div>
        <div class="h-3 bg-gray-200 rounded w-32"></div>
      </div>
    </div>
  </div>`;
    wrapper.replaceChildren(node);
  }
  effect(() => render());
  return wrapper;
}
export {
  hydrateClientComponent,
  metadata
};
