const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

/**
 * Matches default import statements, capturing:
 *   Group 1 — the imported identifier  (e.g. "Weather")
 *   Group 2 — the module path string   (e.g. "components/weather/weather-state.vex")
 *
 * Matches:  import Weather from "components/weather/weather-state.vex"
 * Does NOT match named imports ({ foo }) — those are handled separately if needed.
 */
const IMPORT_REGEX = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;

/**
 * Walks up the directory tree from `startDir` looking for the nearest
 * folder that contains a `package.json`. That folder is treated as the
 * project root, which is used to resolve non-relative import paths.
 *
 * @param {string} startDir - Absolute path to start searching from.
 * @returns {string} Absolute path to the project root, or `startDir` if none found.
 */
function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

/**
 * Locates the `vexjs` package directory so that `vex/` imports can be
 * resolved to the framework's client services files.
 *
 * Checks two locations in order:
 *   1. `<projectRoot>/node_modules/vexjs`  — installed as a dependency
 *   2. `<projectRoot>/../vexjs`             — sibling folder in a monorepo
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {string|null} Absolute path to the vexjs directory, or null if not found.
 */
function findVexjsDir(projectRoot) {
  const candidates = [
    path.join(projectRoot, "node_modules", "vexjs"),
    path.join(projectRoot, "..", "vexjs"),
  ];
  return candidates.find(fs.existsSync) || null;
}

/**
 * Resolves an import path string to an absolute filesystem path.
 *
 * Resolution rules (applied in order):
 *   1. Relative paths (`./` or `../`) — resolved relative to the file that
 *      contains the import.
 *   2. `vex/` prefix — resolved to `<vexjsDir>/client/services/<rest>`.
 *      This is the VexJS framework's public import alias.
 *   3. Everything else — resolved relative to the project root.
 *      Covers paths like `components/foo.vex` or `utils/delay.js`.
 *
 * @param {string} importPath     - The raw path from the import statement.
 * @param {string} currentFileDir - Absolute directory of the file containing the import.
 * @param {string} projectRoot    - Absolute path to the project root.
 * @returns {string} Absolute path (without extension resolution — see tryExtensions).
 */
function resolveImportPath(importPath, currentFileDir, projectRoot) {
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    return path.resolve(currentFileDir, importPath);
  }
  if (importPath.startsWith("vex/")) {
    const vexjsDir = findVexjsDir(projectRoot);
    if (vexjsDir) {
      const relative = importPath.replace("vex/", "");
      return path.resolve(vexjsDir, "client", "services", relative);
    }
  }
  return path.resolve(projectRoot, importPath);
}

/**
 * Given a resolved path (which may lack an extension or point to a directory),
 * tries common suffixes until it finds an existing file.
 *
 * Candidates tried in order:
 *   - exact path as given
 *   - path + .js / .vex / .ts
 *   - path/index.js / path/index.vex / path/index.ts  (directory import)
 *
 * @param {string} filePath - Absolute path to test (may or may not have extension).
 * @returns {string|null} The first existing file path found, or null if none exist.
 */
function tryExtensions(filePath) {
  const candidates = [
    filePath,
    filePath + ".js",
    filePath + ".vex",
    filePath + ".ts",
    path.join(filePath, "index.js"),
    path.join(filePath, "index.vex"),
    path.join(filePath, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Extension entry point called by VS Code when a .vex file is opened.
 *
 * Registers two providers for the `vexjs` language:
 *
 *   - **DocumentLinkProvider** — scans the whole document and turns every
 *     resolvable import into a clickable hyperlink. Both the imported name
 *     (e.g. `Weather`) and the path string are made clickable. This is what
 *     enables Ctrl+Click on any character of the import, not just word tokens.
 *
 *   - **DefinitionProvider** — handles F12 / "Go to Definition". Called by
 *     VS Code with the current cursor position; checks whether the cursor sits
 *     on an imported name or path string and returns the target file location.
 *
 * @param {vscode.ExtensionContext} context - Extension context provided by VS Code.
 */
function activate(context) {
  const linkProvider = vscode.languages.registerDocumentLinkProvider("vexjs", {
    provideDocumentLinks(document) {
      const links = [];

      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        IMPORT_REGEX.lastIndex = 0;
        let match;

        while ((match = IMPORT_REGEX.exec(line)) !== null) {
          const [, importName, importPath] = match;
          const currentFileDir = path.dirname(document.fileName);
          const projectRoot = findProjectRoot(currentFileDir);
          const resolved = resolveImportPath(importPath, currentFileDir, projectRoot);
          const finalPath = tryExtensions(resolved);

          if (!finalPath) continue;

          const target = vscode.Uri.file(finalPath);

          const nameStart = line.indexOf(importName, match.index);
          links.push(new vscode.DocumentLink(
            new vscode.Range(i, nameStart, i, nameStart + importName.length),
            target
          ));

          const pathStart = line.indexOf(importPath, match.index);
          links.push(new vscode.DocumentLink(
            new vscode.Range(i, pathStart, i, pathStart + importPath.length),
            target
          ));
        }
      }

      return links;
    },
  });

  const definitionProvider = vscode.languages.registerDefinitionProvider("vexjs", {
    provideDefinition(document, position) {
      const line = document.lineAt(position).text;
      IMPORT_REGEX.lastIndex = 0;
      let match;

      while ((match = IMPORT_REGEX.exec(line)) !== null) {
        const [, importName, importPath] = match;

        const nameStart = line.indexOf(importName, match.index);
        const nameRange = new vscode.Range(position.line, nameStart, position.line, nameStart + importName.length);
        const pathStart = line.indexOf(importPath, match.index);
        const pathRange = new vscode.Range(position.line, pathStart, position.line, pathStart + importPath.length);

        if (!nameRange.contains(position) && !pathRange.contains(position)) continue;

        const currentFileDir = path.dirname(document.fileName);
        const projectRoot = findProjectRoot(currentFileDir);
        const resolved = resolveImportPath(importPath, currentFileDir, projectRoot);
        const finalPath = tryExtensions(resolved);

        if (finalPath) {
          return new vscode.Location(vscode.Uri.file(finalPath), new vscode.Position(0, 0));
        }
      }
    },
  });

  context.subscriptions.push(linkProvider, definitionProvider);
}

/**
 * Called by VS Code when the extension is deactivated (e.g. window closed).
 * No cleanup needed — VS Code disposes the registered providers automatically
 * via the subscriptions added in `activate`.
 */
function deactivate() {}

module.exports = { activate, deactivate };
