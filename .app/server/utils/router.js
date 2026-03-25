import {
  renderSuspenseComponent,
  generateReplacementContent,
} from "./streaming.js";
import { getCachedComponentHtml, getRevalidateSeconds, revalidateCachedComponentHtml, saveCachedComponentHtml } from "./cache.js";
import { getPagePath } from "./files.js";
import { renderPageWithLayout } from "./component-processor.js";
import { routes } from "./_routes.js";

const FALLBACK_ERROR_HTML = `
  <!DOCTYPE html>
  <html>
  <head><title>Error 500</title></head>
  <body>
    <h1>Error 500 - Internal Server Error</h1>
    <p>An unexpected error has occurred.</p>
    <p><a href="/">Back to home</a></p>
  </body>
  </html>
`;

/**
 * Sends HTML response
 * @param {import("http").ServerResponse} res
 * @param {number} statusCode
 * @param {string} html
 */
const sendResponse = (res, statusCode, html) => {
  res.writeHead(statusCode, { "Content-Type": "text/html" });
  res.end(html);
};

/**
 * Start stream response, sending html and update html chunks
 * @param {import("http").ServerResponse} res
 * @param {string[]} htmlChunks
 */
const sendStartStreamChunkResponse = (res, statusCode, html, htmlChunks) => {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Transfer-Encoding": "chunked",
    "X-Content-Type-Options": "nosniff",
  });
  sendStreamChunkResponse(res, html, htmlChunks)
};

/**
 * Send html and update html chunks
 * @param {import("http").ServerResponse} res
 * @param {string[]} htmlChunks
 */
const sendStreamChunkResponse = (res, html, htmlChunks) => {
  res.write(html);
  htmlChunks.push(html);
}

/**
 * Close html and end response
 * @param {import("http").ServerResponse} res
 * @param {string[]} htmlChunks
 */
const endStreamResponse = (res, htmlChunks) => {
  res.write("</body></html>");
  res.end();
  htmlChunks.push("</body></html>")
}

/**
 * Renders a page using SSR, optionally streams suspense components,
 * applies Incremental Static Regeneration (ISR) when enabled,
 * and sends the resulting HTML response to the client.
 *
 * This function supports:
 * - Full server-side rendering
 * - Streaming suspense components
 * - ISR with cache revalidation
 * - Graceful abort handling on client disconnect
 *
 * @async
 * @function renderAndSendPage
 *
 * @param {Object} params
 * @param {string} params.pageName
 *   Name of the page to be rendered (resolved to a server component path).
 *
 * @param {number} [params.statusCode=200]
 *   HTTP status code used for the response.
 *
 * @param {Object} [params.context={}]
 *   Rendering context shared across server components.
 *
 * @param {import("http").IncomingMessage} params.context.req
 *   Incoming HTTP request instance.
 *
 * @param {import("http").ServerResponse} params.context.res
 *   HTTP response instance used to stream or send HTML.
 *
 * @param {Object.<string, any>} [params.context]
 *   Additional arbitrary values exposed to the rendering pipeline.
 *
 * @param {Object} params.route
 *   Matched route configuration.
 *
 * @param {string} params.route.path
 *   Public route path (e.g. "/home").
 *
 * @param {string} params.route.serverPath
 *   Internal server path used for resolution.
 *
 * @param {Object} params.route.meta
 *   Route metadata.
 *
 * @param {boolean} params.route.meta.ssr
 *   Whether the route supports server-side rendering.
 *
 * @param {boolean} params.route.meta.requiresAuth
 *   Indicates if authentication is required.
 *
 * @param {number} params.route.meta.revalidate
 *   ISR revalidation interval in seconds. A value > 0 enables ISR.
 *
 * @returns {Promise<void>}
 *   Resolves once the response has been fully sent.
 *
 * @throws {Error}
 *   Throws if rendering or streaming fails before the response is committed.
 */
async function renderAndSendPage({
  pageName,
  statusCode = 200,
  context = {},
  route,
}) {
  const pagePath = getPagePath(pageName);
  const revalidateSeconds = getRevalidateSeconds(route.meta?.revalidate ?? 0);
  const isISR = revalidateSeconds !== 0;

  // Normalise the cache key to pathname only
  // `context.req.url` includes the query string (e.g. `/page?debug=true`).
  // Using the full URL as a cache key means `/page` and `/page?debug=true`
  // generate two separate cache entries for the same page content.
  const isrCacheKey = new URL(context.req.url, "http://x").pathname;

  if(isISR) {
    const { html: cachedHtml, isStale } = await getCachedComponentHtml({
      componentPath: isrCacheKey,
      revalidateSeconds: revalidateSeconds,
    });

    if(cachedHtml && !isStale) {
      sendResponse(context.res, statusCode, cachedHtml);
      return;
    }
  }

  const { html, suspenseComponents, serverComponents } =
    await renderPageWithLayout(pagePath, context);

  // if no suspense components, send immediately
  if (suspenseComponents.length === 0) {
    sendResponse(context.res, statusCode, html);

    if(isISR) {
      saveCachedComponentHtml({ componentPath: isrCacheKey, html });
    }
    return;
  }

  const htmlChunks = [];
  let abortedStream = false;
  let errorStream = false

  context.res.on("close", () => abortedStream = true);

  // send initial HTML (before </body>)
  const [beforeClosing] = html.split("</body>");
  sendStartStreamChunkResponse(context.res, 200, beforeClosing, htmlChunks)

  // stream suspense components
  const renderPromises = suspenseComponents.map(async (suspenseComponent) => {
    try {
      const renderedContent = await renderSuspenseComponent(
        suspenseComponent,
        serverComponents
      );

      const replacementContent = generateReplacementContent(
        suspenseComponent.id,
        renderedContent
      );

      sendStreamChunkResponse(context.res, replacementContent, htmlChunks)
    } catch (error) {
      console.error(`Error rendering suspense ${suspenseComponent.id}:`, error);

      const errorContent = generateReplacementContent(
        suspenseComponent.id,
        `<div class="text-red-500">Error loading content</div>`
      );

      context.res.write(errorContent);
      errorStream = true;
    }
  });

  await Promise.all(renderPromises);

  endStreamResponse(context.res, htmlChunks);

  if(isISR && !abortedStream && !errorStream) {
    saveCachedComponentHtml({
      componentPath: isrCacheKey,
      html: htmlChunks.join("")
    });
  }
}

/**
 * Handles an incoming HTTP request for a page route.
 *
 * Resolves the appropriate route, builds the rendering context,
 * delegates rendering to `renderAndSendPage`, and ensures that
 * errors are handled gracefully by rendering a fallback error page.
 *
 * @async
 * @function handlePageRequest
 *
 * @param {import("http").IncomingMessage} req
 *   Incoming HTTP request.
 *
 * @param {import("http").ServerResponse} res
 *   HTTP response used to send rendered content.
 *
 * @param {Object|null} route
 *   Matched route definition. If null, a fallback 404 route is used.
 *
 * @param {string} route.path
 *   Public URL path of the route.
 *
 * @param {Object} route.meta
 *   Route metadata used during rendering.
 *
 * @returns {Promise<void>}
 *   Resolves once the response has been fully handled.
 */
export async function handlePageRequest(req, res, route) {
  if (!route) {
    const notFoundRoute = routes.find(r => r.isNotFound);
    return handlePageRequest(req, res, notFoundRoute);
  }

  const pageName = route.path.slice(1);

  const context = { req, res };

  try {
    await renderAndSendPage({ pageName, context, route });
  } catch (e) {
    const errorData = {
      message: e.message || "Internal server error",
      code: 500,
      details: "Could not load the requested page",
      path: route.path,
      stack: e.stack,
    };

    try {
      await renderAndSendPage({ 
        pageName: "error", 
        statusCode: 500, 
        context: { 
          ...context, 
          ...errorData,
        }, 
        route,
      });
    } catch (err) {
      console.error(`Failed to render error page: ${err.message}`);
      sendResponse(res, 500, FALLBACK_ERROR_HTML);
    }
  }
}


/**
 * Handler to mark a cached component or page as stale for ISR-like revalidation.
 *
 * This endpoint allows clients to request that the server invalidate the cached HTML
 * of a specific component or page. The cache will be regenerated automatically
 * on the next request for that component.
 *
 * @async
 * @param {import('express').Request} req - The Express request object. Expects a query parameter `path` specifying the component/page path to revalidate.
 * @param {import('express').Response} res - The Express response object. Will send a JSON response indicating success or failure.
 *
 * @returns {Promise<import('express').Response>} JSON response with:
 *   - 200: { message: string } if the cache was successfully marked as stale
 *   - 400: { error: string } if the required `path` query parameter is missing
 *   - 500: { error: string } if an unexpected error occurs during revalidation
 *
 * @example
 * Client request:
 * POST /revalidate?path=/about
 * 
 * Response:
 * {
 *   "message": "Cache for '/about' marked as stale. It will regenerate on next request."
 * }
 */
export async function revalidatePath(req, res) {
  try {
    const componentPath = req.query.path;

    if (!componentPath) {
      return res.status(400).json({ error: "Missing 'path' query parameter" });
    }

    await revalidateCachedComponentHtml(componentPath);

    return res.status(200).json({
      message: `Cache for '${componentPath}' marked as stale. It will regenerate on next request.`
    });
  } catch (err) {
    console.error("Error revalidating cache:", err);
    return res.status(500).json({ error: "Failed to revalidate cache" });
  }
}