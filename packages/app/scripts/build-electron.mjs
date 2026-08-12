/**
 * Production Electron build without vite-plugin-electron's nested closeBundle.
 *
 * On Windows CI, `ELECTRON=1 vite build` (plugin builds main/preload inside
 * closeBundle) can leave esbuild workers alive and hang forever. This script
 * builds renderer → main → preload as separate top-level Vite builds, then exits.
 *
 * Dev (`pnpm dev:electron`) still uses vite-plugin-electron in vite.config.ts.
 */
import { build as viteBuild, mergeConfig, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// vite-plugin-electron helpers (externalize Node builtins + electron)
const {
  build: buildElectronEntry,
  withExternalBuiltins,
  resolveViteConfig,
} = require("vite-plugin-electron");

async function buildRenderer() {
  console.log("[build-electron] renderer…");
  await viteBuild(
    defineConfig({
      configFile: false,
      root: appRoot,
      plugins: [react()],
      resolve: {
        alias: {
          "@": resolve(appRoot, "src"),
        },
      },
      base: "./",
      build: {
        outDir: "dist",
        emptyOutDir: true,
      },
    }),
  );
}

async function buildMain() {
  console.log("[build-electron] main…");
  await buildElectronEntry({
    entry: resolve(appRoot, "electron/main.ts"),
    vite: {
      root: appRoot,
      build: {
        outDir: "dist-electron",
        emptyOutDir: true,
        rollupOptions: {
          external: ["electron", "electron-updater"],
        },
      },
    },
  });
}

async function buildPreload() {
  console.log("[build-electron] preload…");
  const config = withExternalBuiltins(
    resolveViteConfig({
      vite: mergeConfig(
        {
          root: appRoot,
          build: {
            outDir: "dist-electron",
            emptyOutDir: false,
            rollupOptions: {
              input: resolve(appRoot, "electron/preload.ts"),
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
                inlineDynamicImports: true,
              },
              external: ["electron"],
            },
          },
        },
        {},
      ),
    }),
  );
  await viteBuild(config);
}

async function main() {
  process.chdir(appRoot);
  await buildRenderer();
  await buildMain();
  await buildPreload();
  console.log("[build-electron] done");
  // Ensure CI shells exit even if a stray handle remains.
  process.exit(0);
}

main().catch((error) => {
  console.error("[build-electron] failed:", error);
  process.exit(1);
});
