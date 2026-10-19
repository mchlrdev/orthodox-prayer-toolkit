/**
 * Compile-time app version from Vite `define`.
 *
 * A direct read of `__APP_VERSION__` throws `ReferenceError` when the
 * identifier was never defined — that is how the packaged Electron renderer
 * is built (`build-electron.mjs` used to omit `define`). `typeof` is safe.
 */
export function viteAppVersion(): string | null {
  return typeof __APP_VERSION__ === "undefined" ? null : __APP_VERSION__;
}
