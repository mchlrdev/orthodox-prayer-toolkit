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
