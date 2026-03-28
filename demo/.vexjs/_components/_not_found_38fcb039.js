// <stdin>
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = { "title": "404 - Page not found | Vanilla JS", "description": "The page you are looking for does not exist." };
function hydrateClientComponent(marker, incomingProps = {}) {
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div class="flex items-center justify-center min-h-[60vh]">
    <div class="max-w-md w-full space-y-8 text-center">
      <div class="mx-auto">
        <div class="text-9xl font-extrabold text-blue-600 animate-pulse">
          404
        </div>
        <div class="text-6xl mt-4 animate-bounce">
          🔍
        </div>
      </div>
      <div class="space-y-4">
        <h1 class="text-3xl font-bold text-gray-900">
          Oops! Page not found
        </h1>
        <p class="text-lg text-gray-600 max-w-sm mx-auto">
          The page you're looking for doesn't exist or has been moved to another location.
        </p>
      </div>
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="/"
            class="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 no-underline">
            🏠 Go home
          </a>

          <button onclick="history.back()"
            class="inline-flex items-center justify-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200">
            ⬅️ Go back
          </button>
        </div>
        <div class="mt-8">
          <p class="text-sm text-gray-500 mb-3">Or you can visit:</p>
          <div class="flex flex-wrap justify-center gap-2">
            <a href="/meteo-ssr"
              class="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors duration-200">
              🌤️ Weather SSR
            </a>
            <span class="text-gray-300">•</span>
            <a href="/meteo-csr"
              class="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors duration-200">
              🌤️ Weather CSR
            </a>
            <span class="text-gray-300">•</span>
            <a href="/"
              class="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors duration-200">
              🏠 Home
            </a>
          </div>
        </div>
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
