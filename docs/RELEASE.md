# Releasing Orthodox Prayer Toolkit

Desktop builds (macOS DMG/ZIP, Windows NSIS, Linux AppImage) are produced by
GitHub Actions and published to **GitHub Releases**. Installed apps update
themselves via `electron-updater` against those releases.

## From your Mac (happy path)

1. Ensure `main` is green (CI) and you are ready to ship.
2. Bump the version in [`packages/app/package.json`](../packages/app/package.json)
   (source of truth for electron-builder). Keep the root `package.json` version
   in sync if you use it for reference.
3. Commit, then tag and push:

```bash
git tag v0.2.0
git push origin main --tags
```

4. The [Release workflow](../.github/workflows/release.yml) runs on
   `macos-latest`, `windows-latest`, and `ubuntu-latest`, uploads installers to
   the GitHub Release for that tag, and writes `latest*.yml` metadata that
   auto-update needs.

5. Confirm the release page lists:
   - macOS: `.dmg`, `.zip`, `latest-mac.yml`
   - Windows: `.exe` (NSIS), `latest.yml`
   - Linux: `.AppImage`, `latest-linux.yml`

### Local smoke test (macOS only)

```bash
pnpm install
pnpm dist:dir   # unpacked app under packages/app/release/
# or
pnpm dist       # DMG + ZIP locally (does not publish)
```

Unsigned local builds are fine for you; Gatekeeper will warn other users until
you enable signing (below).

## Auto-update behaviour

- Packaged apps check GitHub Releases a few seconds after launch.
- Menu: **Check for Updates…** (app menu on macOS, Help on Windows/Linux).
- When an update is downloaded, the user can restart immediately or later
  (`quitAndInstall` on quit).
- Dev / `pnpm dev:electron` never talks to the update feed.

Update checks require a **public** GitHub repository (or a token for private
repos — not the default OSS setup).

## Open-source downloads (unsigned)

You can ship without certificates. Users download from:

`https://github.com/<owner>/<repo>/releases`

Expect OS warnings:

| Platform | What users see | Workaround |
|----------|----------------|------------|
| macOS | “App can’t be opened because… unidentified developer” | Right-click app → **Open** (once), or System Settings → Privacy & Security |
| Windows | SmartScreen “Windows protected your PC” | **More info** → **Run anyway** |
| Linux | Usually none for AppImage | `chmod +x` the AppImage |

Unsigned builds still auto-update as long as Release assets + `latest*.yml`
files are present.

---

## Code signing & notarization (recommended)

Do this after the unsigned pipeline works. Order: **Apple first**, then Windows.
Linux AppImage is typically left unsigned (optional GPG later).

### 1. Apple Developer ID + notarize (~99 USD/year)

1. Enroll at [developer.apple.com](https://developer.apple.com/programs/).
2. In Certificates, Identifiers & Profiles create a
   **Developer ID Application** certificate (not Mac App Store).
3. Export it from Keychain Access as a `.p12` (set a strong password).
4. Create an **App Store Connect API key** (Users and Access → Keys → App Manager
   or Admin): download the `.p8`, note **Key ID** and **Issuer ID**.
5. Add GitHub Actions secrets (repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `MAC_CSC_LINK` | Base64 of the `.p12`, **or** raw file contents as electron-builder accepts for `CSC_LINK` (file path in CI is usually base64 — see below) |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_API_KEY` | Full contents of `AuthKey_XXXX.p8` |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer UUID |
| `APPLE_TEAM_ID` | Optional Team ID |

Encode the certificate for GitHub:

```bash
base64 -i DeveloperID.p12 | pbcopy   # paste into MAC_CSC_LINK
```

`afterSign` hook [`packages/app/scripts/notarize.cjs`](../packages/app/scripts/notarize.cjs)
runs notarization when the Apple API secrets are present and skips otherwise.

Hardened Runtime entitlements live in
[`packages/app/build/entitlements.mac.plist`](../packages/app/build/entitlements.mac.plist).

### 2. Windows Authenticode

1. Buy an **OV** (or **EV**) code signing certificate from a CA (SSL.com, Sectigo,
   DigiCert, …). EV builds SmartScreen trust faster; OV works and reputation
   grows with downloads.
2. Alternative: [Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/)
   if you already use Azure (good for CI).
3. Export a `.pfx` / `.p12` and set:

| Secret | Value |
|--------|--------|
| `WIN_CSC_LINK` | Base64 of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | PFX password |

```bash
# Git Bash / WSL / macOS with the pfx available:
base64 -i WindowsCodeSign.pfx | pbcopy
```

### Shared secret names

If you only ever sign one platform at a time, you may use `CSC_LINK` /
`CSC_KEY_PASSWORD` instead. The release workflow prefers
`MAC_*` / `WIN_*` and falls back to `CSC_*`.

### Verifying signed builds

- **macOS:** `spctl --assess --verbose --type execute "Orthodox Prayer Toolkit.app"`
  and check that notarization stapled (`xcrun stapler validate …`).
- **Windows:** Properties → Digital Signatures on the installer.

---

## Repository URL

[`package.json` `repository.url`](../package.json) should match your real GitHub
owner/repo so electron-builder’s GitHub publisher and in-app “GitHub Releases”
links stay correct. In Actions, `GITHUB_REPOSITORY` is also used.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| No `latest-mac.yml` on release | macOS job failed or didn’t publish |
| App never sees updates | Tag not semver `vX.Y.Z`, or version in app `package.json` ≥ release |
| macOS: `packages/app not a file` / empty CSC password | Empty `CSC_LINK` was exported — release workflow must `unset` empty signing env vars |
| Linux: `executableName` contains `@` | Missing `executableName` in electron-builder.yml (package name is scoped) |
| macOS CI fails on signing | Missing `CSC_IDENTITY_AUTO_DISCOVERY=false` without cert — workflow sets this when secrets are empty |
| Notarize skipped | Missing `APPLE_API_*` secrets (expected for unsigned) |
| pnpm / electron-builder module not found | Repo uses `.npmrc` `shamefully-hoist=true` for packaging |
