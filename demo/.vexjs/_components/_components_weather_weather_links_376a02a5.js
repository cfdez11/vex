// <stdin>
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const props = { ...{ "links": [] }, ...incomingProps };
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<section class="flex justify-end mt-4">
      ${props.links.map((link) => html`<a :href='${link.href}' class="text-blue-600 hover:underline font-medium">
        View ${link.label} Weather →
      </a>`)}
    </section>`;
    wrapper.replaceChildren(node);
  }
  effect(() => render());
  return wrapper;
}
export {
  hydrateClientComponent,
  metadata
};
