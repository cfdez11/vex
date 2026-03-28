/**
 * Parses the URL search string into a plain object.
 *
 * This function represents the **raw URL state**:
 * - Keys and values are always strings
 * - No defaults are applied
 * - No parsing or validation is performed
 *
 * Example:
 *   "?page=2&tags=js,spa" → { page: "2", tags: "js,spa" }
 *
 * @param {string} search - window.location.search
 * @returns {Object.<string, string>}
 */
function parseRawQuery(search) {
  const out = {};
  const qs = new URLSearchParams(search);

  for (const [k, v] of qs.entries()) {
    out[k] = v;
  }

  return out;
}

/**
 * Builds a query string from a raw params object.
 *
 * - Values are stringified
 * - `null` and `undefined` values are omitted
 *
 * Example:
 *   { page: "2", tags: "js,spa" } → "page=2&tags=js,spa"
 *
 * @param {Object.<string, any>} raw
 * @returns {string} Query string without leading "?"
 */
function buildQueryString(raw) {
  const qs = new URLSearchParams();

  for (const k in raw) {
    if (raw[k] != null) {
      qs.set(k, String(raw[k]));
    }
  }

  return qs.toString();
}

/**
 * Manages URL query parameters as application state.
 *
 * This hook provides:
 * - Parsing via schema (similar to nuqs)
 * - Default values
 * - URL synchronization (push / replace)
 * - Back/forward navigation support
 *
 * The URL remains the single source of truth.
 *
 * @param {Object} options
 * @param {Object.<string, Function>} [options.schema]
 *   Map of query param parsers.
 *   Each function receives the raw string value (or undefined)
 *   and must return a parsed value with a default fallback.
 *
 * @param {boolean} [options.replace=false]
 *   If true, uses history.replaceState instead of pushState.
 *
 * @param {boolean} [options.listen=true]
 *   If true, listens to popstate events to keep state in sync.
 *
 * @returns {Object}
 */
export function useQueryParams(options = {}) {
  const { schema = {}, replace = false, listen = true } = options;

  /**
   * Compute default values by executing schema parsers
   * with an undefined input.
   */
  const defaults = {};
  for (const key in schema) {
    defaults[key] = schema[key](undefined);
  }

  /**
   * Raw query params as strings.
   * This mirrors exactly what exists in the URL.
   */
  let raw = parseRawQuery(window.location.search);

  /**
   * Parses raw query params using the provided schema.
   *
   * - Schema keys are always present (defaults applied)
   * - Unknown params are passed through as strings
   *
   * @param {Object.<string, string>} raw
   * @returns {Object} Parsed params ready for application use
   */
  function parseWithSchema(raw) {
    const parsed = {};

    // Apply schema parsing and defaults
    for (const key in schema) {
      const parser = schema[key];
      parsed[key] = parser(raw[key]);
    }

    // Preserve non-declared query params
    for (const key in raw) {
      if (!(key in parsed)) {
        parsed[key] = raw[key];
      }
    }

    return parsed;
  }

  /**
   * Serializes application-level values into
   * raw URL-safe string values.
   *
   * - Arrays are joined by comma
   * - null / undefined values are omitted
   *
   * @param {Object} next
   * @returns {Object.<string, string>}
   */
  function serializeWithSchema(next) {
    const out = {};

    for (const key in next) {
      const value = next[key];

      if (Array.isArray(value)) {
        out[key] = value.join(",");
      } else if (value != null) {
        out[key] = String(value);
      }
    }

    return out;
  }

  /**
   * Synchronizes the internal raw state with the browser URL.
   *
   * @param {Object.<string, string>} nextRaw
   */
  function sync(nextRaw) {
    raw = nextRaw;

    const qs = buildQueryString(raw);
    const url =
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;

    history[replace ? "replaceState" : "pushState"](null, "", url);
  }

  /**
   * Updates one or more query params.
   *
   * Values are serialized and merged with existing params.
   *
   * @param {Object} next
   */
  function set(next) {
    const serialized = serializeWithSchema(next);
    sync({ ...raw, ...serialized });
  }

  /**
   * Removes one or more query params.
   *
   * @param {...string} keys
   */
  function remove(...keys) {
    const next = { ...raw };
    keys.forEach((k) => delete next[k]);
    sync(next);
  }

  /**
   * Removes all query params from the URL.
   */
  function reset() {
    sync({});
  }

  /**
   * Keeps internal state in sync with browser
   * back/forward navigation.
   */
  if (listen) {
    window.addEventListener("popstate", () => {
      raw = parseRawQuery(window.location.search);
    });
  }

  return {
    /**
     * Parsed query params.
     *
     * This is a getter, so values are always derived
     * from the current raw URL state.
     */
    get params() {
      return parseWithSchema(raw);
    },

    /**
     * Raw query params as strings.
     * Exposed mainly for debugging or tooling.
     */
    get raw() {
      return { ...raw };
    },

    set,
    remove,
    reset,
  };
}
