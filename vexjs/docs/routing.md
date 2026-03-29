# Routing & Project Structure

## Project structure

```
my-app/
├── pages/                    # File-based routes
│   ├── layout.vex            # Root layout (wraps all pages)
│   ├── page.vex              # Home page  →  /
│   ├── about/page.vex        # About page →  /about
│   ├── users/[id]/page.vex   # Dynamic    →  /users/:id
│   ├── not-found/page.vex    # 404 handler
│   └── error/page.vex        # 500 handler
├── components/               # Reusable .vex components
├── utils/                    # User utilities
├── public/                   # Static assets served at /
│   └── styles.css            # Compiled Tailwind output
├── src/
│   └── input.css             # Tailwind entry point
├── root.html                 # HTML shell template (optional override)
└── vex.config.json           # Framework config (optional)
```

> Generated files are written to `.vexjs/` — do not edit them manually.

### Custom source directory

If you prefer to keep all app code in a subfolder, set `srcDir` in `vex.config.json`:

```
my-app/
├── app/               ← srcDir: "app"
│   ├── pages/
│   └── components/
├── public/
└── vex.config.json
```

## File-based routes

| File | Route |
|------|-------|
| `pages/page.vex` | `/` |
| `pages/about/page.vex` | `/about` |
| `pages/users/[id]/page.vex` | `/users/:id` |
| `pages/not-found/page.vex` | 404 |
| `pages/error/page.vex` | 500 |

Routes are auto-generated from the `pages/` folder — no manual registration needed.

## Dynamic routes

```html
<!-- pages/users/[id]/page.vex -->
<script server>
  async function getData({ req }) {
    const { id } = req.params;
    return { user: await fetchUser(id) };
  }
</script>

<template>
  <h1>{{user.name}}</h1>
</template>
```

## Pre-generate dynamic pages (SSG)

```js
// inside <script server>
export async function getStaticPaths() {
  return [
    { params: { id: "1" } },
    { params: { id: "2" } },
  ];
}
```

## Client-side navigation

```js
window.app.navigate("/about");
```

## Route & query params (client)

```js
import { useRouteParams } from "vex/navigation";
import { useQueryParams } from "vex/navigation";

const { id }     = useRouteParams();  // reactive, updates on navigation
const { search } = useQueryParams();
```

## Prefetching

Add `data-prefetch` to any `<a>` tag to prefetch the page when the link enters the viewport:

```html
<a href="/about" data-prefetch>About</a>
```

The page component is loaded in the background; navigation to it is instant.
