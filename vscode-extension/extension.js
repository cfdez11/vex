const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

// Group 1: default import name (optional), Group 2: import path
const IMPORT_REGEX = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;

function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

function findVexjsDir(projectRoot) {
  const candidates = [
    path.join(projectRoot, "node_modules", "vexjs"),
    path.join(projectRoot, "..", "vexjs"),
  ];
  return candidates.find(fs.existsSync) || null;
}

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

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  // DocumentLinkProvider: makes the entire import string a clickable link
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

          // Link on the imported name (e.g. Weather)
          const nameStart = line.indexOf(importName, match.index);
          links.push(new vscode.DocumentLink(
            new vscode.Range(i, nameStart, i, nameStart + importName.length),
            target
          ));

          // Link on the path string
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

  // DefinitionProvider: F12 / "Go to Definition" support
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

function deactivate() {}

module.exports = { activate, deactivate };
