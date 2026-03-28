// <stdin>
import { useCounter } from "/_vexjs/user/utils/counter.js";
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const { counter } = useCounter();
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div class="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-4 py-1">
    <span class="text-sm font-medium text-blue-700">Counter:</span>
    <span class="text-sm font-bold text-blue-900">${counter}</span>
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
