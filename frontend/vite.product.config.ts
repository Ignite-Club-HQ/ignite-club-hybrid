import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

if (process.env.IGNITE_PRODUCT_BUILD !== "1") {
  throw new Error("Product builds must use the guarded build:product script");
}

export default defineConfig({
  envDir: false,
  envPrefix: "IGNITE_PRODUCT_UNUSED_",
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": "/src" } },
  plugins: [
    visualizer({
      filename: "dist-product/bundle-analysis.html",
      template: "treemap",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
    visualizer({
      filename: "dist-product/bundle-analysis.json",
      template: "raw-data",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  build: {
    outDir: "dist-product",
    emptyOutDir: true,
    target: ["es2020", "safari15"],
    sourcemap: false,
    rollupOptions: {
      input: "product-index.html",
    },
  },
});
