// <stdin>
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const props = { ...{ "children": null }, ...incomingProps };
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div>

    <header class="bg-white shadow-lg border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center py-6">
          <h1 class="text-3xl font-bold text-gray-900 hover:text-blue-600 transition-colors duration-200">
            <a href="/"
              class="text-3xl font-bold text-gray-900 hover:text-blue-600 transition-colors duration-200 no-underline">
              Vanilla JS
            </a>
          </h1>

          <nav class="hidden md:flex items-center gap-8">
            <template id="client-NavCounter-1774706734481" data-client:component="_components_nav_counter_5ac9e880" data-client:props='{}'></template>
            <ul class="flex space-x-8 items-center">
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/">
                  Home SSR
                </a>
              </li>
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/page-csr">
                  Page CSR
                </a>
              </li>
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/page-ssr">
                  Page SSR
                </a>
              </li>
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/static" data-prefetch>
                  Static (Prefetch)
                </a>
              </li>
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/static-with-data">
                  Static fetched data
                </a>
              </li>
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/private-ssr">
                  Private SSR
                </a>
              </li>
              <li>
                <a class="text-gray-600 hover:text-blue-600 font-medium transition-colors duration-200 border-b-2 border-transparent hover:border-blue-600 pb-1"
                  href="/private-csr">
                  Private CSR
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>

    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 min-h-[60vh]">
        ${props.children}
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-gray-900 text-white mt-auto">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="flex flex-col md:flex-row justify-between items-center">
          <div class="mb-4 md:mb-0">
            <p class="text-gray-300 text-sm">
              © 2025 Vanilla JS
            </p>
          </div>
          <div class="flex space-x-6">
            <a href="#" class="text-gray-300 hover:text-white transition-colors duration-200 text-sm">
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
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
