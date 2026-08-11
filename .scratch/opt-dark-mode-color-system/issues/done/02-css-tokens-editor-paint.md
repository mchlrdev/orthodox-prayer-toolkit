# 02 — CSS Base/Accent tokens and theme-aware editor paint

**What to build:** App chrome CSS defines `--opt-base` and `--opt-accent` (hex only here). Light and dark schemes set surface/text/base/accent. Prayer editor applies kind colors via `var(--opt-base)` / `var(--opt-accent)`. ColorSelect offers only Base and Accent. “Accent initial” label. Initials/notes/outline accents use the Accent variable. No scattered oxblood/black hex outside the token block.

**Blocked by:** 01 — Kind style colors as base/accent tokens

**Status:** done

- [ ] `--opt-base` / `--opt-accent` replace oxblood/black tokens; hex only in `:root` / dark scheme block
- [ ] Dark scheme surfaces/text invert appropriately; Base becomes light text in dark
- [ ] Inline editor / notes / initial cap resolve through CSS variables
- [ ] ColorSelect is Base + Accent only (no custom palette UI)
- [ ] “Red initial” renamed to “Accent initial”
