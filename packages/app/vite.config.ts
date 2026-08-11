import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { resolve } from "node:path";
import { prayerToolkitBrowserFs } from "./vite-plugin-browser-fs";

const toolkitRoot = resolve(__dirname, "../..");
const enableElectron = process.env.ELECTRON === "1";

export default defineConfig({
  plugins: [
    react(),
    prayerToolkitBrowserFs(toolkitRoot),
    ...(enableElectron
      ? [
          electron({
            main: {
              entry: "electron/main.ts",
              onstart(args) {
                // Cursor/agent shells set ELECTRON_RUN_AS_NODE=1; if inherited,
                // Electron boots as plain Node and crashes on `import "electron"`.
                const env = { ...process.env };
                delete env.ELECTRON_RUN_AS_NODE;
                args.startup([".", "--no-sandbox"], { env });
              },
              vite: {
                build: {
                  outDir: "dist-electron",
                  rollupOptions: {
                    external: ["electron"],
                  },
                },
              },
            },
            preload: {
              input: "electron/preload.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  rollupOptions: {
                    external: ["electron"],
                    output: {
                      format: "cjs",
                      entryFileNames: "preload.cjs",
                    },
                  },
                },
              },
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
});
