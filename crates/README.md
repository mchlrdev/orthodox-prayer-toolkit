# Rust rewrite (GPUI)

Work in progress on branch `rewrite/gpui`: a native replacement for the
Electron app in `packages/app`, built with [GPUI](https://www.gpui.rs/) via
[gpui-kit](https://docs.rs/gpui-kit). The Electron app on `main` stays the
shipping app until this reaches feature parity.

| Crate | Role |
|-------|------|
| `prayer-core` | Rust port of `packages/core`; shares `packages/core/schema` and its test fixtures |
| `prayer-ui` | Desktop app binary (`orthodox-prayer-toolkit`) |

```bash
cargo run -p prayer-ui   # open the app
cargo test --workspace
```

Linux needs the system libraries listed in `.github/workflows/rust.yml`.

## Beta releases

Tag `gpui-vX.Y.Z-beta.N` and push it. The
[GPUI Release workflow](../.github/workflows/gpui-release.yml) builds macOS,
Windows and Linux packages with [Velopack](https://velopack.io) and publishes
them as a GitHub **pre-release**, so the Electron app's `electron-updater`
(which reads stable `v*` releases) never offers them.

An installed beta checks that feed on launch, downloads in the background and
installs on restart — the same five states as the Electron app
(`dev`, up to date, available, ready, error). A build whose version has a
pre-release segment follows pre-releases; a plain version follows stable
releases.

`workflow_dispatch` builds the packages without uploading anything, to check
the pipeline without cutting a release.
