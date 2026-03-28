/**
 * Tagged template literal to create HTML elements with Vue-like directives.
 *
 * Supported syntax:
 * 
 * 1. Text interpolation:
 *    html`<span>${value}</span>`
 * 
 * 2. Attribute interpolation:
 *    html`<div class="${className}" id="${id}"></div>`
 * 
 * 3. Event bindings (@event):
 *    html`<button @click="${handler}">Click</button>`
 * 
 * 4. Property/Boolean bindings (:prop):
 *    html`<button :disabled="${isDisabled}">Send</button>`
 * 
 * 5. Conditional rendering (x-if, x-else-if, x-else):
 *    html`<div x-if="${condition}">Show if true</div>`
 *    html`<div x-else>Show if false</div>`
 *
 * 6. Loop rendering (x-for):
 *    html`<li x-for="${item => items}">Item: ${item}</li>`
 * 
 * 7. Nested templates and arrays:
 *    html`<div>${items.map(item => html`<li>${item}</li>`)}</div>`
 */

/**
 * Main template literal function for creating DOM elements.
 * Processes directives, text interpolation, attributes, and events.
 *
 * @param {TemplateStringsArray} strings - The literal strings from the template.
 * @param  {...any} values - Interpolated values, can be primitives, arrays, or nodes.
 * @returns {HTMLElement | DocumentFragment} - The rendered DOM node(s).
 */
export function html(strings, ...values) {
  // Generate unique markers for interpolation positions
  const markers = values.map((_, i) => `__HTML_MARKER_${i}__`);

  // Combine template strings and markers to form HTML string
  let htmlString = strings[0];
  for (let i = 0; i < values.length; i++) {
    htmlString += markers[i] + strings[i + 1];
  }

  // Create a template element to parse HTML
  const template = document.createElement("template");
  template.innerHTML = htmlString.trim();

  // Clone content to avoid mutating the template
  const fragment = template.content.cloneNode(true);

  // Process VexJS directives (x-if, x-else-if, x-else, x-for)
  processDirectives(fragment, markers, values);

  // Determine single root element or return a fragment
  const node =
    fragment.childElementCount === 1
      ? fragment.firstElementChild
      : fragment;

  // Process text interpolations, attributes, and event bindings
  processNode(node, markers, values);

  return node;
}

/**
 * Recursively processes directives on a node and its children.
 * Supports x-if, x-else-if, x-else, and x-for.
 *
 * @param {Node} node - The DOM node or fragment to process.
 * @param {string[]} markers - Unique markers for interpolated values.
 * @param {any[]} values - Interpolated values.
 */
function processDirectives(node, markers, values) {
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  const children = Array.from(node.childNodes);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.hasAttribute('x-if')) {
        // skip all processed nodes in the conditional chain
        i = handleConditionalChain(node, children, i, markers, values);
        continue;
      }

      if (child.hasAttribute('x-for')) {
        handleVFor(child, markers, values);
        continue;
      }

      processDirectives(child, markers, values);
    }
  }
}

/**
 * Processes x-if, x-else-if, and x-else chains.
 * Keeps the first element whose condition is truthy.
 *
 * @param {Node} parent - Parent node of the conditional chain.
 * @param {Node[]} children - List of child nodes.
 * @param {number} startIndex - Index where v-if chain starts.
 * @param {string[]} markers - Unique markers for interpolation.
 * @param {any[]} values - Interpolated values.
 * @returns {number} - Updated index after processing chain.
 */
function handleConditionalChain(parent, children, startIndex, markers, values) {
  const chain = [];
  let currentIndex = startIndex;

  // Collect all conditional elements in the chain
  while (currentIndex < children.length) {
    const element = children[currentIndex];
    if (element.nodeType !== Node.ELEMENT_NODE) {
      currentIndex++;
      continue;
    }

    if (element.hasAttribute('x-if')) {
      if (chain.length > 0) break; // second x-if starts a new independent chain
      chain.push({
        element,
        type: 'if',
        condition: element.getAttribute('x-if'),
      });
      currentIndex++;
    } else if (element.hasAttribute('x-else-if')) {
      if (!chain.length) break;
      chain.push({
        element,
        type: 'else-if',
        condition: element.getAttribute('x-else-if'),
      });
      currentIndex++;
    } else if (element.hasAttribute('x-else')) {
      if (!chain.length) break;
      chain.push({ 
        element, 
        type: 'else', 
        condition: null,
      });
      currentIndex++;
      break; // v-else must be last
    } else break;
  }

  // Evaluate chain and keep only the first truthy element
  let kept = null;
  for (const item of chain) {
    if (kept) {
      item.element.remove();
      continue;
    }

    if (item.type === 'else') {
      kept = item.element;
      item.element.removeAttribute('x-else');
    } else {
      const markerIndex = markers.findIndex(m => item.condition.includes(m));
      const condition = markerIndex !== -1 ? values[markerIndex] : false;
      if (condition) {
        kept = item.element;
        item.element.removeAttribute(item.type === 'if' ? 'x-if' : 'x-else-if');
      } else {
        item.element.remove();
      }
    }
  }

  return currentIndex - 1;
}

/**
 * Handles x-for directives to render lists.
 * Clones the template element for each item in the array.
 *
 * @param {HTMLElement} element - Template element with x-for attribute.
 * @param {string[]} markers - Unique markers for interpolation.
 * @param {any[]} values - Interpolated values (must include array for v-for).
 */
function handleVFor(element, markers, values) {
  const vForValue = element.getAttribute('x-for');
  const markerIndex = markers.findIndex(m => vForValue.includes(m));
  if (markerIndex === -1 || !Array.isArray(values[markerIndex])) {
    element.removeAttribute('x-for');
    return;
  }

  const items = values[markerIndex];
  const parent = element.parentNode;
  const template = element.cloneNode(true);
  template.removeAttribute('x-for');

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const clone = template.cloneNode(true);
    replaceItemReferences(clone, item);
    fragment.appendChild(clone);
  }

  parent.replaceChild(fragment, element);
}

/**
 * Replaces item references in cloned v-for elements.
 *
 * @param {Node} node - Node to replace references in.
 * @param {Object} item - Current item from the array.
 */
function replaceItemReferences(node, item) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.value.includes('item.')) {
        const prop = attr.value.replace('item.', '');
        node.setAttribute(attr.name, item[prop] ?? '');
      }
    }
  }
  
  for (const child of Array.from(node.childNodes)) {
    replaceItemReferences(child, item)
  };
}

/**
 * Recursively processes nodes, replacing markers with actual values.
 * Also handles attributes and event listeners.
 *
 * @param {Node} node - Node to process.
 * @param {string[]} markers - Unique markers for interpolation.
 * @param {any[]} values - Interpolated values.
 */
function processNode(node, markers, values) {
  if (node.nodeType === Node.TEXT_NODE) {
    return processTextNode(node, markers, values)
  };
  if (node.nodeType === Node.ELEMENT_NODE) {
    processAttributes(node, markers, values);
  }
  for (const child of Array.from(node.childNodes)) {
    processNode(child, markers, values);
  }
}

/**
 * Processes text nodes by replacing markers with values.
 * Supports primitives, nodes, and arrays of nodes.
 *
 * @param {Text} node - Text node to process.
 * @param {string[]} markers - Unique markers for interpolation.
 * @param {any[]} values - Interpolated values.
 */
function processTextNode(node, markers, values) {
  let text = node.textContent;

  for (let i = 0; i < markers.length; i++) {
    if (!text.includes(markers[i])) {
      continue;
    }
    const value = values[i];
    const parent = node.parentNode;
    const parts = text.split(markers[i]);

    if (parts[0]) {
      parent.insertBefore(document.createTextNode(parts[0]), node);
    }

    if (Array.isArray(value)) {
      // Insert arrays of nodes or primitives
      for (const item of value) {
        if (item instanceof Node) {
          processNode(item, markers, values);
          parent.insertBefore(item, node);
        } else {
          parent.insertBefore(document.createTextNode(String(item ?? "")), node);
        }
      }
    } else if (value instanceof Node) {
      processNode(value, markers, values);
      parent.insertBefore(value, node);
    } else {
      parent.insertBefore(document.createTextNode(String(value ?? "")), node);
    }

    text = parts.slice(1).join(markers[i]);
  }

  node.textContent = text;
}

/**
 * Maps special HTML attributes to DOM properties.
 *
 * @param {string} attrName - Attribute name from template.
 * @returns {object|string} - Property name and joinability or original string.
 */
function getNodePropertyInfo(attrName) {
  const nodeProperties = { 
    class: { property: "className", canBeJoined: true } 
  };
  return nodeProperties[attrName] || { property: attrName, canBeJoined: false };
}

/**
 * Processes element attributes.
 * Supports:
 * - @event bindings: adds native DOM event listeners.
 * - :prop bindings: sets DOM properties and boolean attributes.
 *
 * @param {HTMLElement} element - Element to process.
 * @param {string[]} markers - Interpolation markers.
 * @param {any[]} values - Interpolated values.
 */
function processAttributes(element, markers, values) {
  for (const attr of Array.from(element.attributes)) {
    // Event binding: @event
    if (attr.name.startsWith("@")) {
      const event = attr.name.slice(1);
      const idx = markers.findIndex(m => attr.value.includes(m));
      const handler = values[idx];

      if (typeof handler === "function") {
        element.addEventListener(event, handler);
      }

      element.removeAttribute(attr.name);
      continue;
    }

    // Property/boolean binding: :prop
    if (attr.name.startsWith(":")) {
      const { property, canBeJoined } = getNodePropertyInfo(attr.name.slice(1));
      const idx = markers.findIndex((m) => attr.value.includes(m));

      if (idx !== -1) {
        const value = values[idx];
        if (typeof value === "boolean") {
          element.toggleAttribute(property, value);
        }
        else {
          element[property] = canBeJoined && element[property] 
            ? `${element[property]} ${value}` 
            : value;
        }
      }

      element.removeAttribute(attr.name);
    }

    // x-show directive
    if (attr.name === "x-show") {
      const idx = markers.findIndex((m) => attr.value.includes(m));
      const value = idx !== -1 ? values[idx] : false;
      element.style.display = value ? "" : "none";
      element.removeAttribute("x-show");
      continue;
    }

    // data set attributes
    if(attr.name.startsWith("data-")) {
      const dataAttr = attr.name.slice(5);
      const idx = markers.findIndex((m) => attr.value.includes(m));

      if (idx !== -1) {
        const value = values[idx];
        element.dataset[dataAttr] = typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value ?? "");
      }
    }
  }
}
