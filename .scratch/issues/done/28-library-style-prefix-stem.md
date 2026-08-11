# 28 — Library style-prefix stem

**What to build:** In Library Settings einen optionalen Style-Prefix-Stamm pflegen (Stamm tippen, `_` fest angehängt; Validierung `[A-Za-z][A-Za-z0-9]*` oder leer). Leer/absent → App-Konstante Stamm `opt`. Persistenz über das Library-Manifest. Ein Resolution-Helfer liefert die wirksame Library→`opt`-Kette für spätere Export-UI.

**Blocked by:** None — can start immediately

**Status:** done

- [ ] Library Settings: Prefix-Stamm-Feld mit festem `_`-Affordance; ungültige Stämme speicherbar nur wenn valid (oder Save gesperrt)
- [ ] Manifest speichert optionalen Stamm; leer/absent fällt bei Resolution auf `opt`
- [ ] Resolution-Helfer: Library-Stamm wenn gesetzt und nicht leer, sonst `opt`
- [ ] Bestehende Manifest-Felder (description, defaultVariant) bleiben unverändert nutzbar
