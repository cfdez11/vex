# VexJS Monorepo

This repository contains the VexJS framework and related packages.

## Packages

| Package | Description |
|---|---|
| [`vexjs`](./vexjs) | The VexJS framework — file-based routing, SSR/CSR/SSG/ISR, Vue-like reactivity |
| [`demo`](./demo) | Example project using VexJS |
| [`vscode-extension`](./vscode-extension) | VS Code extension with syntax highlighting for `.vex` files |

## Getting Started

### Monorepo (development)

```bash
pnpm install
pnpm --filter demo dev
```

### New project (from npm)

See the [vexjs README](./vexjs/README.md) for installation and usage.
