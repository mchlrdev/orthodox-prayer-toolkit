# 10 - Where the Electron app stores kind styles

Ticket: `docs/wayfinder/gpui-rewrite/issues/10-electron-settings-location.md`

## Summary

The packaged Electron app stores app-level kind styles in one file, `kind-styles.json`, directly inside Electron's `userData` directory. The app name is `Orthodox Prayer Toolkit` (with spaces and capitals), so the directory is `<appData>/Orthodox Prayer Toolkit/`.

| OS | Concrete path |
|----|---------------|
| macOS | `~/Library/Application Support/Orthodox Prayer Toolkit/kind-styles.json` |
| Windows | `%APPDATA%\Orthodox Prayer Toolkit\kind-styles.json` (typically `C:\Users\<user>\AppData\Roaming\Orthodox Prayer Toolkit\kind-styles.json`) |
| Linux | `$XDG_CONFIG_HOME/Orthodox Prayer Toolkit/kind-styles.json`, falling back to `~/.config/Orthodox Prayer Toolkit/kind-styles.json` |

Format: UTF-8 JSON, pretty-printed with 2-space indent and a trailing newline. The top level is a plain object mapping kind id to a flat object of string-valued style fields. There is no wrapper, no version field, and no `$schema`:

```json
{
  "verse": { "fontSize": "1rem", "color": "base", "fontWeight": "400", "fontStyle": "normal", "initialCap": "true", "htmlTag": "p", "textAlign": "justify" }
}
```

- Kind id: must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`.
- Allowed fields (all strings, max 64 chars): `fontSize`, `color`, `fontWeight`, `fontStyle`, `initialCap`, `indicate`, `htmlTag`, `textAlign`.
- Value rules:
  - `fontSize` is a CSS length (`0`, or a number plus `px`, `rem`, `em` or `%`).
  - `color` is `"base"`, `"accent"` or a legacy hex that is normalised to a token.
  - `fontWeight` is `normal`, `bold`, `bolder`, `lighter` or `100`-`900`.
  - `fontStyle` is `normal`, `italic` or `oblique`.
  - `initialCap` and `indicate` are the strings `"true"` or `"false"`, not booleans.
  - `htmlTag` is an allowlisted tag.
  - `textAlign` is `left`, `center` or `justify`.
- The file may be missing (first run). The reader then uses built-in defaults.
- The file is partial: only kinds the user changed or added need to appear.
- On load, each entry is shallow-merged over `DEFAULT_KIND_STYLES` for the preset kinds `heading`, `subheading`, `annotation` and `verse`. Custom kinds are taken as-is.
- Invalid entries are silently dropped. A JSON parse error yields the defaults.

For migration, the new app should read this file if present, run the same sanitising and merging as `parseAppStyles`, and otherwise fall back to defaults.

## Evidence

Directory derivation:

- `packages/app/package.json:4` sets `"productName": "Orthodox Prayer Toolkit"`. `package.json:2` has `"name": "@orthodox-prayer-toolkit/app"`.
- `packages/app/electron-builder.yml:2` sets `productName: Orthodox Prayer Toolkit` (same value). `electron-builder.yml:4` sets `executableName: OrthodoxPrayerToolkit`, which only affects the binary name. `electron-builder.yml:56` (`linux.executableName`) is `orthodox-prayer-toolkit`. Neither is used for `userData`.
- `packages/app/electron/main.ts:42-43` has `const APP_NAME = "Orthodox Prayer Toolkit"; app.setName(APP_NAME);`. This is the same string as `productName`, so any name resolution gives the same value.
- No `app.setPath` or `sessionData` calls exist in `packages/app/electron`. A grep for `userData` finds only `main.ts:147`. The default location is therefore never overridden.
- `packages/app/scripts/fix-electron-name.mjs` (the ticket's `scripts/fix-electron-name.mjs` lives under `packages/app/`) only matters in dev on macOS. It renames `Electron.app` to `Orthodox Prayer Toolkit.app` and patches `CFBundleName` and `CFBundleDisplayName` in `Info.plist` (file header, lines 1-9). It does not touch `userData` or package.json. It is called from `postinstall` and `dev:electron` (`package.json` scripts).
- Electron's rule, per the `app.getPath` docs:
  - `appData` is `%APPDATA%` on Windows, `$XDG_CONFIG_HOME` or `~/.config` on Linux, and `~/Library/Application Support` on macOS.
  - `userData` is "by default the `appData` directory appended with your app's name".
- Electron's `app.getName()` docs say the name comes from `package.json`, and that `productName` "will be preferred over `name`". `app.setName` "overrides the name used internally by Electron". Both routes resolve to `Orthodox Prayer Toolkit` here.
- Caveat: I did not execute the app. `app.setName` runs at module load, after Electron's own init has already set `userData` from package.json. This is harmless here because both names are identical.
- `packages/app/package.json` has `"main": "dist-electron/main.js"`, so Electron reads this package.json even in dev.

Read/write code:

- `packages/app/electron/main.ts:146-148`: `appStylesPath()` returns `join(app.getPath("userData"), "kind-styles.json")`.
- `main.ts:298-306`: IPC `styles:readApp` returns `null` if the file is missing, otherwise the raw UTF-8 string. IPC `styles:writeApp` does a plain `writeFileSync(path, content, "utf8")`. No `mkdirSync` is used (the directory is assumed to exist), and there is no atomic write.
- `packages/app/electron/preload.ts:89-90` exposes these as `readAppStyles` and `writeAppStyles`.
- Reader: `packages/app/src/usePrayerSession.ts:200-212` calls `api.readAppStyles()` once at startup, then `parseAppStyles(raw)`.
- `packages/app/src/session/parseAppStyles.ts:7-20`:
  - `null` or empty input returns `{...DEFAULT_KIND_STYLES}`.
  - Otherwise it does `JSON.parse`, then `sanitizeStyles`.
  - It merges into a copy of the defaults, with `{...base, ...style}` when a default exists for that kind.
  - A `catch` returns the defaults.
- Writer: `packages/app/src/session/operations.ts:756` writes `` `${JSON.stringify(checked.styles, null, 2)}\n` ``, after strict validation (`checked`, which is `validateStyles`, lines ~745-755). A second write happens in `applyKindRename` at `operations.ts:902-904` with the same format.
- Validation: `packages/core/src/validateStyles.ts`:
  - `KIND_ID_PATTERN` is at line 14, `ALLOWED_FIELDS` at lines 28-37, and the `DANGEROUS` pattern at line 39.
  - Per-field rules are in `validateField` (lines ~62-150).
  - `sanitizeStyles` (best-effort, drops invalid entries and unknown fields) starts around line 160. `validateStyles` (strict) is at the end of the file.
- Defaults: `packages/core/src/resolveStyles.ts:12-47` (`DEFAULT_KIND_STYLES`). The type is `KindStyle` at `packages/core/src/types.ts:69-83`.
- Colours are tokens (`base`/`accent`), not hex, so the file contains no actual colour values.

## Dev-mode differences

- Electron dev (`pnpm dev:electron`, which runs `ELECTRON=1 vite`) uses the same `userData` path as the packaged app. `main.ts` has no dev-specific `setPath`. `IS_DEV` (`main.ts:39`) is only used for the examples library path (`main.ts:92`) and DevTools shortcuts (`main.ts:866`). Dev and packaged builds therefore share `kind-styles.json`.
- Plain browser dev (`pnpm dev` without `ELECTRON=1`) does not use Electron. `packages/app/vite-plugin-browser-fs.ts:37` writes `<repo root>/.dev-app-styles.json`. The repo root is `toolkitRoot = resolve(__dirname, "../..")` from `vite.config.ts:8`. The GET and POST handlers for `/styles/app` are at `vite-plugin-browser-fs.ts:189-203`. The renderer talks to it through `src/browserToolkit.ts:101-112`.
- The format is identical (same `content` string written verbatim). `.dev-app-styles.json` is gitignored (`.gitignore:44`).
- Nothing needs to be migrated from `.dev-app-styles.json`. It is a developer-only file.

## localStorage prefs (not migrated)

All of these live only in the renderer's `localStorage` (Chromium profile under `userData`, in `Local Storage/leveldb`). They are not in `kind-styles.json`.

| Module | Key | Content |
|--------|-----|---------|
| `packages/app/src/appearancePrefs.ts:1-2` | `orthodox-prayer-toolkit.appearance-prefs` | `{ colorScheme: "light" \| "dark" \| "system" }` |
| `packages/app/src/sidebarPrefs.ts:1` | `orthodox-prayer-toolkit.sidebar-prefs` | `{ libraryCollapsed, contentCollapsed }` booleans |
| `packages/app/src/viewPrefs.ts:3` | `orthodox-prayer-toolkit.prayer-views` | Per library root, per prayer path, a list of `{lang, variant}` active variants |
| `packages/app/src/exportPrefs.ts:6` | `orthodox-prayer-toolkit.export-prefs` | Per library root, per prayer path: export prefs (`includeBlocksWithoutTranslation`, `tagMap`, `wrapperEnabled`, `wrapperTag`, `wrapperAttributes`, `layoutFormat`, `layoutPrefixStem`) |
| `packages/app/src/recentLibraries.ts:1` | `orthodox-prayer-toolkit.recent-libraries` | Array of `{ path, lastOpened }`, max 10 |

Other renderer-side persistence: a grep for `localStorage` under `packages/app/src` matches only these five files. `mantineColorScheme.ts` and `theme.ts` contain no storage calls.

## Sources

Repo (branch `rewrite/gpui`):

- `packages/app/package.json`
- `packages/app/electron-builder.yml`
- `packages/app/electron/main.ts`
- `packages/app/electron/preload.ts`
- `packages/app/scripts/fix-electron-name.mjs`
- `packages/app/vite.config.ts`
- `packages/app/vite-plugin-browser-fs.ts`
- `packages/app/src/session/parseAppStyles.ts`
- `packages/app/src/session/operations.ts`
- `packages/app/src/usePrayerSession.ts`
- `packages/app/src/browserToolkit.ts`
- `packages/app/src/{appearance,sidebar,view,export}Prefs.ts`
- `packages/app/src/recentLibraries.ts`
- `packages/core/src/validateStyles.ts`
- `packages/core/src/resolveStyles.ts`
- `packages/core/src/types.ts`
- `.gitignore`

Electron:

- https://www.electronjs.org/docs/latest/api/app#appgetpathname (`appData` and `userData` definitions)
- https://www.electronjs.org/docs/latest/api/app#appgetname
- https://www.electronjs.org/docs/latest/api/app#appsetnamename
- Source of the above: https://github.com/electron/electron/blob/main/docs/api/app.md, fetched 2026-10-05.
