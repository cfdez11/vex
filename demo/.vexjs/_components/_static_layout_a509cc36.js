// <stdin>
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const props = { ...{ "children": null }, ...incomingProps };
  console.warn("LAYOUT STATIC RENDERED");
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="bg-white rounded-lg border border-gray-200 p-6 min-h-[60vh]">
      ${props.children}
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
