// utils/counter.js
import { reactive, computed } from "/_vexjs/services/reactive.js";
var counter = reactive(77);
var stars = computed(() => Array.from({ length: counter.value }, () => "\u2B50"));
function useCounter() {
  function increment() {
    counter.value++;
  }
  function decrement() {
    counter.value--;
  }
  return { counter, stars, increment, decrement };
}
export {
  counter,
  useCounter
};
