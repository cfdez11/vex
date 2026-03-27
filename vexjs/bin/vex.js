#!/usr/bin/env node

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..", "server");

const [command] = process.argv.slice(2);

/**
 * Available CLI commands.
 *
 * Each entry is a factory function that calls `spawn()` to launch a child
 * process and returns the ChildProcess handle.
 *
 * `spawn(command, args, options)` forks a new OS process running `command`
 * with the given `args`. It is non-blocking: the parent (this CLI) keeps
 * running while the child executes. The returned ChildProcess emits an
 * "exit" event when the child terminates, which we use to forward its exit
 * code so the shell sees the correct status (e.g. for CI).
 *
 * `stdio: "inherit"` wires the child's stdin/stdout/stderr directly to the
 * terminal that launched the CLI. Without it the child's output would be
 * captured internally and never displayed. "inherit" is equivalent to
 * passing [process.stdin, process.stdout, process.stderr].
 */
const commands = {
  /** Start the dev server with Node's built-in file watcher (--watch restarts on .js changes). */
  dev: () =>
    spawn(
      "node",
      ["--watch", path.join(serverDir, "index.js")],
      { stdio: "inherit" }
    ),

  /** Run the prebuild: scan pages/, generate component bundles and route registries. */
  build: () =>
    spawn(
      "node",
      [path.join(serverDir, "prebuild.js")],
      { stdio: "inherit" }
    ),

  /** Start the production server. Sets NODE_ENV=production to disable HMR and file watchers. */
  start: () =>
    spawn(
      "node",
      [path.join(serverDir, "index.js")],
      { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } }
    ),

  /** Run the static build: prebuild + copy assets to dist/ for deployment without a server. */
  "build:static": () =>
    spawn(
      "node",
      [path.join(serverDir, "build-static.js")],
      { stdio: "inherit" }
    ),
};

if (!commands[command]) {
  console.error(`Unknown command: "${command}"\nAvailable: dev, build, build:static, start`);
  process.exit(1);
}

const child = commands[command]();
child.on("exit", code => process.exit(code ?? 0));
