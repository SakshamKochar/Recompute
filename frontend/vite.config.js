import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.RECOMPUTE_API_PROXY_TARGET || "http://127.0.0.1:8000";
  const port = Number(env.RECOMPUTE_WEB_PORT || 5274);
  return {
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    preview: { host: "127.0.0.1", port: port + 1 },
    build: { outDir: "dist-build", assetsDir: "static" },
    test: {
      environment: "jsdom",
      include: ["tests/unit/**/*.test.js"],
    },
  };
});
