import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

export const envPath = path.resolve(process.cwd(), "..", "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envPath, "");

  // Auto-derive URLs from port variables when not explicitly set
  const VITE_WIKI_URL = env.VITE_WIKI_URL || `http://localhost:${env.WIKI_PORT || "5175"}`;

  return {
    define: {
      "process.env": {
        APP_URL: env.APP_URL,
        FILE_UPLOAD_SIZE_LIMIT: env.FILE_UPLOAD_SIZE_LIMIT,
        FILE_IMPORT_SIZE_LIMIT: env.FILE_IMPORT_SIZE_LIMIT,
        DRAWIO_URL: env.DRAWIO_URL,
        CLOUD: env.CLOUD,
        SUBDOMAIN_HOST: env.SUBDOMAIN_HOST,
        COLLAB_URL: env.COLLAB_URL,
        BILLING_TRIAL_DAYS: env.BILLING_TRIAL_DAYS,
        POSTHOG_HOST: env.POSTHOG_HOST,
        POSTHOG_KEY: env.POSTHOG_KEY,
      },
      "import.meta.env.VITE_WIKI_URL": JSON.stringify(VITE_WIKI_URL),
      APP_VERSION: JSON.stringify(process.env.npm_package_version),
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    server: {
      proxy: {
        "/api": {
          target: APP_URL,
          changeOrigin: true,
        },
        "/socket.io": {
          target: APP_URL,
          ws: true,
          rewriteWsOrigin: true,
        },
        "/collab": {
          target: APP_URL,
          ws: true,
          rewriteWsOrigin: true,
        },
      },
    },
  };
});
