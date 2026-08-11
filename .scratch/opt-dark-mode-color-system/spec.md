# Dark mode & duochrome color system

**Status:** ready-for-agent

## Problem Statement

The Orthodox Prayer Toolkit is light-only and spreads liturgical color as hardcoded “oxblood” hex values, Mantine semantic colors (orange/teal/blue/red), and parallel CSS tokens. Editors and kind styles cannot express theme-aware Base/Accent colors, and there is no way to follow system appearance or choose dark mode.

## Solution

Introduce a strict duochrome system (Base + Accent), store kind colors as tokens (`base` | `accent`), resolve them through CSS variables so the prayer editor inverts correctly in dark mode, remove non-duochrome UI accents, and add App settings (Light / Dark / System) with no flash of the wrong theme.

## User Stories

1. As an editor, I want the app to respect my system light/dark preference by default, so that it matches the rest of my desktop.
2. As an editor, I want to override appearance to Light, Dark, or System in App settings, so that I can control contrast for liturgy work.
3. As an editor, I want my appearance choice to persist across restarts, so that I do not reconfigure every session.
4. As an editor, I want the UI to open already in the correct scheme, so that I never see a light flash in dark mode.
5. As an editor, I want prayer text colored with Base to read as body text on both light and dark chrome, so that verses stay readable.
6. As an editor, I want prayer text colored with Accent to keep the liturgical accent in both schemes, so that rubrics/headings stay recognizable.
7. As an editor, I want kind style configs to say `base` or `accent` instead of hex, so that styles are theme-semantic.
8. As an editor, I want the style color picker to offer only Base and Accent, so that I cannot introduce rogue colors.
9. As an editor, I want “Accent initial” instead of “Red initial”, so that naming matches the color system.
10. As an editor, I want unsaved badges and dirty indicators in Accent, so that status uses the brand accent only.
11. As an editor, I want error toasts in Accent and success/info toasts in Base/dark, so that feedback stays duochrome.
12. As an editor, I want destructive confirmations in Accent, so that danger shares the only warm color.
13. As an editor, I want split-column fill complete (100%) in Base/neutral and incomplete fill in Accent, so that progress stays duochrome.
14. As an editor, I want secondary icons to stay gray/subtle as today, so that chrome remains quiet.
15. As a library maintainer, I want example library styles migrated to tokens, so that the repo models the new format.
16. As a library maintainer, I want legacy hex styles normalized on load (known hex → tokens, unknown → base), so that older libraries still open.
17. As a developer, I want hex values defined only in the CSS token layer, so that Accent/Base can change in one place later (including dark Accent).
18. As an editor, I want App settings reachable from the library ⋯ menu, so that appearance is discoverable beside library actions.
19. As a future maintainer, I want App settings structured to accept more fields later, so that we need not redesign the entry point.
20. As an editor, I want Mantine primary actions to stay near-black (Base), so that Accent stays sparse.
21. As an editor, I want inline notes and liturgical initials to use Accent via CSS variables, so that they track the token system.
22. As an editor, I want outline active states and other chrome highlights that used oxblood to use Accent, so that branding is consistent.

## Implementation Decisions

- Kind style `color` in config/JSON is only `"base"` or `"accent"` (no hex in configs).
- On load, normalize: known Base hexes → `base`, known Accent hex (`#8b2942`) → `accent`, already-valid tokens unchanged, anything else → `base`.
- Defaults and fallbacks in core use tokens, not hex.
- Style validation accepts only `base` | `accent` for `color` (after normalization at the sanitize/load boundary).
- Rendering maps tokens to `var(--opt-base)` / `var(--opt-accent)` for inline prayer styles.
- CSS custom properties use the `--opt-` prefix: `--opt-base`, `--opt-accent`, plus existing surface/text tokens; light and dark schemes redefine them. Hex literals live only in that token block.
- Rename/remove `--opt-oxblood` / `--opt-black` in favor of `--opt-accent` / `--opt-base`.
- ColorSelect offers only Base and Accent; remove custom palette persistence UI.
- Label “Red initial” → “Accent initial”; docs that say oxblood → Accent.
- Mantine: keep `primaryColor: "dark"`; register an `accent` palette derived from the Accent hex; use `color="accent"` for destructive/error/highlight; replace orange/teal/blue notification colors with `dark` (OK/info) or `accent` (error); replace orange unsaved/dirty with accent.
- Split fill: complete → base/neutral treatment; incomplete/missing → accent.
- New `appearancePrefs` module (localStorage), preference `light` | `dark` | `system`, default `system`.
- New App settings modal (appearance only for now; layout ready for more sections), opened from library ⋯ menu.
- Mantine color scheme driven by prefs; ColorSchemeScript (or equivalent FOWT guard) before paint.
- Migrate example library `styles.json` to tokens during implementation.
- Gray/subtle secondary controls remain as today.

### Color token shape (decision)

```ts
type StyleColorToken = "base" | "accent";
// KindStyle.color stores StyleColorToken in configs after normalize
```

## Testing Decisions

- Good tests assert external behavior at public seams (validation, normalization, resolve defaults, prefs load/save), not CSS class internals.
- Primary seam: core style validate/sanitize + color normalization (token acceptance, hex migration mapping).
- Secondary seam: appearance prefs load/save/default.
- Prior art: existing `validateStyles` / `resolveStyles` tests in core; prefs modules pattern like sidebar prefs (add unit tests if a seam exists; otherwise keep prefs thin and cover via core + light app tests where present).
- Update tests that assert hex colors on kind styles to expect tokens.

## Out of Scope

- Per-atmosphere / weather themes
- Changing Accent hex for dark mode (architecture allows a later one-line CSS change)
- Baking colors into export formats (exports remain color-free)
- Electron `nativeTheme` deep OS chrome beyond web content scheme
- Broad visual redesign unrelated to tokens/dark mode/duochrome

## Further Notes

- Shared understanding from grilling: strict duochrome; editor inverts via CSS vars; App settings default System; FOWT required.
- Seams for TDD: (1) core color token normalize/validate, (2) appearance prefs. User directed no further questioning — proceed with these seams.
