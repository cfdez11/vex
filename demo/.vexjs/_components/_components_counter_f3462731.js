// <stdin>
import { useCounter } from "/_vexjs/user/utils/counter.js";
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const props = { ...{ "start": 10 }, ...incomingProps };
  const { counter, stars, increment, decrement } = useCounter();
  counter.value = props.start;
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div class="flex items-center justify-between gap-4 w-full">
    <div class="flex items-center gap-6">
      <button @click="${decrement}"
        class="flex items-center justify-center w-10 h-10 bg-red-500 hover:bg-red-600 text-white font-bold rounded-full transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        :disabled='${counter <= 0}'>
        Sub
      </button>

      <div class="flex flex-col items-center gap-2">
        <span class="text-4xl font-bold text-gray-800 min-w-[4rem] text-center">
          ${counter}
        </span>
        <span class="text-sm text-gray-500 uppercase tracking-wide">
          Count
        </span>
      </div>

      <button @click="${increment}"
        class="flex items-center justify-center w-10 h-10 bg-green-500 hover:bg-green-600 text-white font-bold rounded-full transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 cursor-pointer">
        Add
      </button>
    </div>

    <div x-show="${counter}" class="flex items-center gap-1 ml-auto p-2 bg-yellow-50 rounded-lg border border-yellow-200">
      <div class="flex flex-wrap gap-1">
        ${stars.map((star) => html`<span class="text-yellow-500 text-lg">⭐</span>`)}
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
