import fs from "fs/promises";
import express from "express";
import path from "path";
import { pathToFileURL } from "url";
import { handlePageRequest, revalidatePath } from "./utils/router.js";
import { initializeDirectories, CLIENT_DIR, SRC_DIR } from "./utils/files.js";

await initializeDirectories();

let serverRoutes;

if (process.env.NODE_ENV === "production") {
  try {
    const routesPath = path.join(process.cwd(), ".vexjs", "_routes.js");
    const { routes } = await import(pathToFileURL(routesPath).href);
    serverRoutes = routes;
    console.log("Routes loaded.");
  } catch {
    console.error("ERROR: No build found. Run 'pnpm build' before starting in production.");
    process.exit(1);
  }
} else {
  const { build } = await import("./utils/component-processor.js");
  const result = await build();
  console.log("Components and routes generated.");
  serverRoutes = result.serverRoutes;
}

const app = express();

// Serve generated client components at /_vexjs/_components/ (before broader /_vexjs mount)
app.use(
  "/_vexjs/_components",
  express.static(path.join(process.cwd(), ".vexjs", "_components"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript");
      }
    },
  })
);

// Serve generated services (e.g. _routes.js) at /_vexjs/services/ (before broader /_vexjs mount)
app.use(
  "/_vexjs/services",
  express.static(path.join(process.cwd(), ".vexjs", "services"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript");
      }
    },
  })
);

// Serve framework client files at /_vexjs/
app.use(
  "/_vexjs",
  express.static(CLIENT_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript");
      }
    },
  })
);

// Serve user JS utility files at /_vexjs/user/* with import rewriting
app.get("/_vexjs/user/*splat", async (req, res) => {
  const splat = req.params.splat;
  const relPath = Array.isArray(splat) ? splat.join("/") : splat;
  const filePath = path.resolve(path.join(SRC_DIR, relPath));
  // Prevent path traversal outside SRC_DIR
  if (!filePath.startsWith(SRC_DIR + path.sep) && filePath !== SRC_DIR) {
    return res.status(403).send("Forbidden");
  }
  try {
    let content = await fs.readFile(filePath, "utf-8");
    // Rewrite imports to browser-accessible paths
    content = content.replace(
      /^(\s*import\s+[^'"]*from\s+)['"]([^'"]+)['"]/gm,
      (match, prefix, modulePath) => {
        if (modulePath.startsWith("vex/") || modulePath.startsWith(".app/")) {
          let mod = modulePath.replace(/^vex\//, "").replace(/^\.app\//, "");
          if (!path.extname(mod)) mod += ".js";
          return `${prefix}'/_vexjs/services/${mod}'`;
        }
        if (modulePath.startsWith("@/") || modulePath === "@") {
          let resolved = path.resolve(SRC_DIR, modulePath.replace(/^@\//, "").replace(/^@$/, ""));
          if (!path.extname(resolved)) resolved += ".js";
          const rel = path.relative(SRC_DIR, resolved).replace(/\\/g, "/");
          return `${prefix}'/_vexjs/user/${rel}'`;
        }
        if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
          const fileDir = path.dirname(filePath);
          let resolved = path.resolve(fileDir, modulePath);
          if (!path.extname(resolved)) resolved += ".js";
          const rel = path.relative(SRC_DIR, resolved).replace(/\\/g, "/");
          return `${prefix}'/_vexjs/user/${rel}'`;
        }
        return match;
      }
    );
    res.setHeader("Content-Type", "application/javascript");
    res.send(content);
  } catch {
    res.status(404).send("Not found");
  }
});

// Serve user's public directory at /
app.use("/", express.static(path.join(process.cwd(), "public")));

app.get("/revalidate", revalidatePath);

// HMR SSE endpoint — dev only
if (process.env.NODE_ENV !== "production") {
  const { hmrEmitter } = await import("./utils/hmr.js");

  app.get("/_vexjs/hmr", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const onReload = (filename) => {
      res.write(`event: reload\ndata: ${filename}\n\n`);
    };

    hmrEmitter.on("reload", onReload);
    req.on("close", () => hmrEmitter.off("reload", onReload));
  });
}

const registerSSRRoutes = (app, routes) => {
  routes.forEach((route) => {
    app.get(
      route.serverPath,
      async (req, res) => await handlePageRequest(req, res, route)
    );
  });
};

registerSSRRoutes(app, serverRoutes);

app.use(async (req, res) => {
  const notFoundRoute = serverRoutes.find((r) => r.isNotFound);
  if (notFoundRoute) {
    return handlePageRequest(req, res, notFoundRoute);
  }

  res.status(404).send("Page not found");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
