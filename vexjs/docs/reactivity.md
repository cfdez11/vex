# Reactive System

Mirrors Vue 3's Composition API. Import from `vex/reactive` in `<script client>` blocks.

## `reactive(value)`

```js
import { reactive } from "vex/reactive";

// Primitives → access via .value
const count = reactive(0);
count.value++;

// Objects → direct property access
const state = reactive({ x: 1, name: "Alice" });
state.x++;
state.name = "Bob";
```

## `computed(getter)`

Auto-tracked computed value. Read-only via `.value`.

```js
import { reactive, computed } from "vex/reactive";

const price = reactive(100);
const qty   = reactive(2);
const total = computed(() => price.value * qty.value);

console.log(total.value); // 200
price.value = 150;
console.log(total.value); // 300
```

## `effect(fn)`

Runs immediately and re-runs whenever its reactive dependencies change. Returns a cleanup function.

```js
import { reactive, effect } from "vex/reactive";

const count = reactive(0);
const stop = effect(() => document.title = `Count: ${count.value}`);

count.value++; // effect re-runs
stop();        // cleanup
```

## `watch(source, callback)`

Runs only when the source changes — does NOT run on creation.

```js
import { reactive, watch } from "vex/reactive";

const count = reactive(0);
watch(() => count.value, (newVal, oldVal) => {
  console.log(`${oldVal} → ${newVal}`);
});
```

## Summary

| Function | Auto-runs | Returns |
|----------|-----------|---------|
| `reactive()` | No | Proxy |
| `effect()` | Yes (immediately + on change) | Cleanup fn |
| `computed()` | On dependency change | Reactive value |
| `watch()` | Only on change | — |
