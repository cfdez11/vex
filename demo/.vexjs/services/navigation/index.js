import { createNavigationRuntime } from "./create-navigation.js";

const navigation = createNavigationRuntime();

export const initializeRouter = navigation.initialize;
export const navigate = navigation.navigate;
export { useRouteParams } from "./use-route-params.js";
export { useQueryParams } from "./use-query-params.js";
