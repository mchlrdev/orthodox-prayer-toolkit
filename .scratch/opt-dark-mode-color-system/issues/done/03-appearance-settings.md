# 03 — Appearance prefs and App settings (Light/Dark/System)

**What to build:** Users open App settings from the library ⋯ menu and choose Light, Dark, or System (default System). Preference persists. App boots without a flash of the wrong scheme. Modal is appearance-only but structured for later fields.

**Blocked by:** 02 — CSS Base/Accent tokens and theme-aware editor paint

**Status:** done

- [ ] Appearance preference module with `light` | `dark` | `system`, default `system`
- [ ] App settings modal reachable from library ⋯ menu
- [ ] Mantine color scheme follows preference; System tracks OS
- [ ] FOWT guard (ColorSchemeScript or equivalent) before paint
- [ ] Preference persists across reload
