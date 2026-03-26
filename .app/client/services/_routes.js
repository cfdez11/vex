import { loadRouteComponent } from './cache.js';

    
    /**
     * @typedef {Object} RouteMeta
     * @property {boolean} ssr
     * @property {boolean} requiresAuth
     * @property {number} revalidateSeconds
     */

    /**
     * @typedef {Object} Route
     * @property {string} path
     * @property {string} serverPath
     * @property {boolean} isNotFound
     * @property {(marker: HTMLElement) => Promise<{ render: (marker: string) => void, metadata: any}>} [component]
     * @property {RouteMeta} meta
     * @property {Array<{ name: string, importPath: string }>} [layouts]
     */
  
    export const routes = [
      {
      path: "/error",
      meta: {
        ssr: true,
        requiresAuth: false,
      },
    },
{
      path: "/not-found",
      component: async () => {
        const mod = await loadRouteComponent("/not-found", () => import("/.app/client/_components/_not_found_38fcb039.js"));
        
        return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
      },
      layouts: [{"name":"_layout_f70c9cf2","importPath":"/.app/client/_components/_layout_f70c9cf2.js"}],
      meta: {
        ssr: false,
        requiresAuth: false,
      },
    },
{
      path: "/page-csr/:city",
      component: async () => {
        const mod = await loadRouteComponent("/page-csr/:city", () => import("/.app/client/_components/_page_csr_city_3aa0994b.js"));
        
        return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
      },
      layouts: [{"name":"_layout_f70c9cf2","importPath":"/.app/client/_components/_layout_f70c9cf2.js"}],
      meta: {
        ssr: false,
        requiresAuth: false,
      },
    },
{
      path: "/page-csr",
      component: async () => {
        const mod = await loadRouteComponent("/page-csr", () => import("/.app/client/_components/_page_csr_f4051c9e.js"));
        
        return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
      },
      layouts: [{"name":"_layout_f70c9cf2","importPath":"/.app/client/_components/_layout_f70c9cf2.js"}],
      meta: {
        ssr: false,
        requiresAuth: false,
      },
    },
{
      path: "/page-ssr/:city",
      meta: {
        ssr: true,
        requiresAuth: false,
      },
    },
{
      path: "/page-ssr",
      meta: {
        ssr: true,
        requiresAuth: false,
      },
    },
{
      path: "/",
      meta: {
        ssr: true,
        requiresAuth: false,
      },
    },
{
      path: "/static",
      component: async () => {
        const mod = await loadRouteComponent("/static", () => import("/.app/client/_components/_static_de6e0f62.js"));
        
        return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
      },
      layouts: [{"name":"_layout_f70c9cf2","importPath":"/.app/client/_components/_layout_f70c9cf2.js"},{"name":"_static_layout_a509cc36","importPath":"/.app/client/_components/_static_layout_a509cc36.js"}],
      meta: {
        ssr: false,
        requiresAuth: false,
      },
    },
{
      path: "/static-with-data",
      component: async () => {
        const mod = await loadRouteComponent("/static-with-data", () => import("/.app/client/_components/_static_with_data_a0acd4a0.js"));
        
        return { hydrateClientComponent: mod.hydrateClientComponent, metadata: mod.metadata };
      },
      layouts: [{"name":"_layout_f70c9cf2","importPath":"/.app/client/_components/_layout_f70c9cf2.js"}],
      meta: {
        ssr: false,
        requiresAuth: false,
      },
    }
    ];