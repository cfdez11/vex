/**
 * HMR client script — injected only in dev mode (see root.html).
 *
 * Opens a Server-Sent Events connection to `/_vexjs/hmr`. When the server emits
 * a `reload` event (triggered by a file change), the page reloads automatically
 * so the developer always sees the latest version without a manual refresh.
 *
 * On error (e.g. server restart) the connection is closed silently — the
 * browser will reconnect on the next page load.
 */
(function () {
  const evtSource = new EventSource("/_vexjs/hmr");

  evtSource.addEventListener("reload", (e) => {
    console.log(`[HMR] ${e.data || "file changed"} — reloading`);
    location.reload();
  });

  evtSource.onerror = () => {
    evtSource.close();
  };
})();
