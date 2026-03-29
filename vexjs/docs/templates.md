# Template Syntax

## Directives

| Syntax | Description |
|--------|-------------|
| `{{expr}}` | Interpolation |
| `x-if="expr"` | Conditional rendering |
| `x-for="item in items"` | List rendering |
| `x-show="expr"` | Toggle `display` |
| `:prop="expr"` | Dynamic prop/attribute |
| `@click="handler"` | Event binding (client only) |

## Example

```html
<template>
  <h1>Hello, {{name}}</h1>

  <ul>
    <li x-for="item in items">{{item}}</li>
  </ul>

  <div x-if="isVisible">Visible</div>

  <button :disabled="count.value <= 0" @click="count.value--">-</button>
</template>
```

## Scope

Template expressions are evaluated against the object returned by `getData()` merged with `metadata`. Expressions support property access (`user.name`), array indexing (`items[0]`), and method calls (`name.toUpperCase()`).

> Keep logic in `getData` rather than inline expressions. Ternaries and filters are not supported.
