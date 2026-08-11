# 01 — Kind style colors as base/accent tokens

**What to build:** Kind styles in core accept and default to `base`/`accent` only. Legacy hex values normalize on load (known hexes → tokens, unknown → `base`). Validation rejects non-token colors after normalization. Example library styles use tokens. Callers that asserted hex in tests are updated.

**Blocked by:** None — can start immediately.

**Status:** done

- [ ] `KindStyle.color` semantics are `base` | `accent` in defaults/fallback
- [ ] Normalize maps known Base/Accent hexes and passes through tokens; unknown → `base`
- [ ] `validateStyles` / sanitize accept tokens (and normalize hex at the boundary)
- [ ] Example `styles.json` migrated to tokens
- [ ] Core tests cover normalize + validate behavior
