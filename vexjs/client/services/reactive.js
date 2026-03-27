/**
 * Tracks the currently executing effect function for dependency collection.
 * This global variable allows the reactive system to know which effect
 * is currently running and should be notified of reactive property changes.
 */
let activeEffect = null;

/**
 * Adapts primitive values (string, number, boolean, null) to work with the reactive system.
 * Wraps primitive values in an object with a 'value' property and marks them as primitive.
 * Objects are returned as-is since they can already have reactive properties.
 *
 * @param {any} input - The value to adapt for reactivity
 * @returns {object} Object with either the original object or wrapped primitive
 *
 * @example
 * adaptPrimitiveValue(42) // → { value: 42, __isPrimitive: true }
 * adaptPrimitiveValue("hello") // → { value: "hello", __isPrimitive: true }
 * adaptPrimitiveValue({x: 1}) // → {x: 1} (unchanged)
 */
function adaptPrimitiveValue(input) {
  if (input === null || typeof input !== "object") {
    return { value: input, __isPrimitive: true };
  }
  return input;
}

/**
 * Creates a reactive proxy that automatically tracks dependencies and triggers effects.
 * The core of the reactivity system - makes any object or primitive reactive.
 *
 * Features:
 * - Automatic dependency tracking when properties are accessed during effects
 * - Automatic effect triggering when properties change
 * - Support for primitive values through value wrapping
 * - Memory cleanup to prevent leaks
 *
 * @param {any} obj - Object or primitive to make reactive
 * @returns {Proxy} Reactive proxy that tracks dependencies and triggers effects
 *
 * @example
 * With objects
 * const state = reactive({ count: 0, name: "John" });
 * state.count++; // Triggers any effects that used state.count
 *
 * @example
 * With primitives
 * const counter = reactive(0);
 * counter.value++; // Triggers effects that used counter.value
 *
 * @example
 * In components
 * class Counter {
 *   count = reactive(0);
 *
 *   increment() {
 *     this.count.value++; // Automatically re-renders component
 *   }
 *
 *   effect(() => this.render());
 *
 *   render() {
 *     return html`<button @click="${this.increment}">Count: ${this.count.value}</button>`;
 *   }
 * }
 *
 * @example
 * In components with Component base class doesn't require manual effect()
 * class Counter extends Component {
 *   count = reactive(0);
 *
 *   increment() {
 *     this.count.value++; // Automatically re-renders component
 *   }
 *
 *   render() {
 *     return html`<button @click="${this.increment}">Count: ${this.count.value}</button>`;
 *   }
 * }
 *
 */
export function reactive(obj) {
  obj = adaptPrimitiveValue(obj);

  // Map to store dependencies for each property
  const depsMap = new Map();

  const proxy = new Proxy(obj, {
    get(target, prop) {
      // Handle primitive value conversion (for template literals, etc.)
      if (target.__isPrimitive && prop === Symbol.toPrimitive) {
        // Track "value" dependency so effects using ${counter} re-run on change
        if (activeEffect) {
          if (!depsMap.has("value")) depsMap.set("value", new Set());
          const depSet = depsMap.get("value");
          depSet.add(activeEffect);
          if (!activeEffect.deps) activeEffect.deps = [];
          activeEffect.deps.push(depSet);
        }
        return () => target.value;
      }

      // Use 'value' key for primitives, actual property name for objects
      const key = target.__isPrimitive ? "value" : prop;

      // Dependency tracking: if an effect is running, register it as dependent on this property
      if (activeEffect) {
        if (!depsMap.has(key)) depsMap.set(key, new Set());
        const depSet = depsMap.get(key);
        depSet.add(activeEffect);

        // Track dependencies on the effect for cleanup
        if (!activeEffect.deps) activeEffect.deps = [];
        activeEffect.deps.push(depSet);
      }

      return target[key];
    },
    set(target, prop, value) {
      const key = target.__isPrimitive ? "value" : prop;
      target[key] = value;

      // Trigger all effects that depend on this property
      if (depsMap.has(key)) {
        depsMap.get(key).forEach((effect) => effect());
      }

      return true;
    },
  });

  return proxy;
}

/**
 * Creates a reactive effect that automatically re-runs when its dependencies change.
 * This is the foundation of the reactivity system - it tracks which reactive properties
 * are accessed during execution and re-runs the function when any of them change.
 *
 * @param {function} fn - Function to run reactively. Will re-execute when dependencies change
 * @returns {function} Cleanup function to stop the effect and remove all dependencies
 *
 * @example
 * Basic usage
 * const count = reactive(0);
 * const cleanup = effect(() => {
 *   console.log(`Count is: ${count.value}`); // Logs immediately and on changes
 * });
 *
 * count.value++; // Logs: "Count is: 1"
 * cleanup(); // Stops the effect
 */
export function effect(fn) {
  const wrapped = () => {
    activeEffect = wrapped;
    fn();
    activeEffect = null;
  };

  // Run the effect immediately to collect initial dependencies
  wrapped();

  // Return cleanup function
  return () => {
    if (wrapped.deps) {
      wrapped.deps.forEach((depSet) => depSet.delete(wrapped));
    }
  };
}

/**
 * Creates a computed reactive value that automatically updates when its dependencies change.
 * @param {Function} getter
 * @returns {{ value: Object }} Computed reactive value
 *
 * @example
 * Basic usage
 * const count = reactive(1);
 * const doubleCount = computed(() => count.value * 2);
 * console.log(doubleCount.value); // 2
 * count.value = 3;
 * console.log(doubleCount.value); // 6
 */
export function computed(getter) {
  let value;

  effect(() => {
    value = getter();
  });

  return new Proxy({}, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) {
        return () => value;
      }
      if (prop === "value") {
        return value;
      }
      // Delegate any other access (e.g. .map, .length) to the underlying value
      const v = value?.[prop];
      return typeof v === "function" ? v.bind(value) : v;
    },
  });
}

/**
 * Watches a reactive source and runs a callback when its value changes.
 *
 * @template T
 * @param {() => T} source - A getter function returning the reactive value to watch.
 * @param {(newValue: T, oldValue: T | undefined, onCleanup: (fn: () => void) => void) => void} callback
 * @param {{ immediate?: boolean }} [options]
 */
export function watch(source, callback, options = {}) {
  let oldValue;
  let cleanupFn;

  const onCleanup = (fn) => {
    cleanupFn = fn;
  };

  const runner = () => {
    const newValue = source();

    // Skip first run if not immediate
    if (oldValue === undefined && !options.immediate) {
      oldValue = newValue;
      return;
    }

    // Avoid unnecessary executions
    if (Object.is(newValue, oldValue)) return;

    // Cleanup previous effect
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }

    callback(newValue, oldValue, onCleanup);
    oldValue = newValue;
  };

  // Track dependencies reactively
  effect(runner);
}

