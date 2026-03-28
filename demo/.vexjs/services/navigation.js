// Barrel file for vex/navigation imports.
// Components import { useRouteParams } from "vex/navigation" which esbuild
// rewrites to /_vexjs/services/navigation.js (external). All re-exports go
// through navigation/index.js so the browser module cache ensures the same
// runtime instance is shared with the index.js bootstrap.
export { useRouteParams, useQueryParams, navigate } from "./navigation/index.js";
