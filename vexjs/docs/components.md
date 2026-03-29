# Components & Layouts

## Component structure

Every `.vex` file has three optional sections:

```html
<script server>
  // Runs on the server per request. Can use Node.js APIs, async/await, imports.
  const metadata = { title: "Page title" };

  async function getData({ req, props }) {
    return { user: await fetchUser(req.params.id) };
  }
</script>

<script client>
  // Bundled and sent to the browser.
  import { reactive } from "vex/reactive";
  const count = reactive(0);
</script>

<template>
  <h1>{{title}}</h1>
  <button @click="count.value++">{{count.value}}</button>
</template>
```

## Server components

```html
<!-- components/user-card.vex -->
<script server>
  const props = xprops({ userId: { default: null } });

  async function getData({ props }) {
    const user = await fetch(`https://api.example.com/users/${props.userId}`)
      .then(r => r.json());
    return { user };
  }
</script>

<template>
  <div>
    <h3>{{user.name}}</h3>
    <p>{{user.email}}</p>
  </div>
</template>
```

## Client components

```html
<!-- components/counter.vex -->
<script client>
  import { reactive, computed } from "vex/reactive";

  const props = xprops({ start: { default: 0 } });
  const count = reactive(props.start);
  const stars = computed(() => "⭐".repeat(count.value));
</script>

<template>
  <div>
    <button @click="count.value--">-</button>
    <span>{{count.value}}</span>
    <button @click="count.value++">+</button>
    <div>{{stars.value}}</div>
  </div>
</template>
```

## Using components

Import server components in `<script server>` and client components in `<script client>`:

```html
<script server>
  import UserCard from "@/components/user-card.vex";
</script>

<script client>
  import Counter from "@/components/counter.vex";
</script>

<template>
  <Counter :start="5" />
  <UserCard :userId="1" />
</template>
```

## Component props (`xprops`)

```js
const props = xprops({
  userId: { default: null },
  label:  { default: "Click me" },
});
```

Pass them from the parent template:

```html
<UserCard :userId="user.id" label="Profile" />
```

## Layouts

### Root layout

`pages/layout.vex` wraps every page:

```html
<script server>
  const props = xprops({ children: { default: "" } });
</script>

<template>
  <header>
    <nav>
      <a href="/" data-prefetch>Home</a>
      <a href="/about" data-prefetch>About</a>
    </nav>
  </header>
  <main>{{props.children}}</main>
  <footer>© 2026</footer>
</template>
```

### Nested layouts

Add a `layout.vex` inside any subdirectory:

```
pages/
  layout.vex               ← wraps everything
  docs/
    layout.vex             ← wraps /docs/* only
    page.vex
    getting-started/page.vex
```

## Suspense (Streaming)

Streams a fallback immediately while a slow component loads:

```html
<script server>
  import SlowCard     from "@/components/slow-card.vex";
  import SkeletonCard from "@/components/skeleton-card.vex";
</script>

<template>
  <Suspense :fallback="<SkeletonCard />">
    <SlowCard :userId="1" />
  </Suspense>
</template>
```

The server sends the skeleton on the first flush, then replaces it with the real content via a streamed `<template>` tag when it resolves.
