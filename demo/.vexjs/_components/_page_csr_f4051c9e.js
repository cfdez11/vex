// <stdin>
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = { "title": "Page CSR", "description": "CSR page fetching data in client-side using a client component" };
function hydrateClientComponent(marker, incomingProps = {}) {
  const links = [
    { href: "/page-csr/madrid", label: "Madrid" },
    { href: "/page-csr/barcelona", label: "Barcelona" },
    { href: "/page-csr/londres", label: "Londres" },
    { href: "/page-csr/nuevayork", label: "Nueva York" },
    { href: "/page-csr/paris", label: "Par\xEDs" },
    { href: "/page-csr/tokio", label: "Tokio" }
  ];
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div class="max-w-6xl mx-auto px-4 py-8">
    <header class="mb-12 text-center">
      <div class="inline-block bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-semibold mb-4">
        ⚡ Client-Side Rendering (CSR)
      </div>
      <h1 class="text-4xl font-bold mb-4">Weather Dashboard</h1>
      <p class="text-lg text-gray-600 max-w-2xl mx-auto">
        The page loads immediately and data is fetched dynamically from the
        browser using reactive components.
      </p>
      <div class="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg inline-block">
        <p class="text-sm text-green-800">
          ⚡ <strong>Note:</strong> This page loaded instantly! Data is
          fetched asynchronously on the client after the page renders.
        </p>
      </div>
    </header>
    <template id="client-Weather-1774706734482" data-client:component="_components_weather_weather_state_5886c775" data-client:props='{}'></template>
    <template id="client-WeatherLinks-1774706734482" data-client:component="_components_weather_weather_links_376a02a5" data-client:props='${JSON.stringify({ "links": links })}'></template>
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
