/**
 * Updates the document's `<title>` and `<meta name="description">` tags
 * based on the provided metadata.
 *
 * If a `<meta name="description">` tag does not exist, it will be created.
 *
 * @param {Object} metadata - Page metadata to apply.
 * @param {string} [metadata.title] - Title to set for the document.
 * @param {string} [metadata.description] - Description to set in the meta tag.
 */
export function addMetadata(metadata) {
  if (metadata.title) document.title = metadata.title;

  if (metadata.description) {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = metadata.description;
  }
}
