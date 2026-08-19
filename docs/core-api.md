# Core API

Package: `@orthodox-prayer-toolkit/core`

Pure TypeScript — no Electron dependency. This is the **test seam** and the integration surface for other tools.

```bash
pnpm --filter @orthodox-prayer-toolkit/core build
```

Entry: `packages/core/src/index.ts` → `dist/`. Schema file ships under `packages/core/schema/`.

## Validate

```ts
import { validate } from "@orthodox-prayer-toolkit/core";

const result = validate(unknownJson);
if (result.ok) {
  // result.prayer: Prayer
} else {
  // result.errors: { path: string; message: string }[]
}
```

## Export

### Flat variant (JSON-shaped object)

```ts
import { exportVariant } from "@orthodox-prayer-toolkit/core";

const flat = exportVariant(prayer, {
  lang: "de",
  variant: "standard",
  // includeBlocksWithoutTranslation?: boolean
});
```

Produces `FlatPrayer`: single title/license/source and a structure for that variant only.

### HTML

```ts
import { exportHtml, tagMapFromStyles } from "@orthodox-prayer-toolkit/core";

const html = exportHtml(prayer, {
  lang: "de",
  variant: "standard",
  tagMap: tagMapFromStyles(styles),
  wrapper: { enabled: true, tag: "article" },
});
```

Tags are allowlisted (`HTML_TAG_ALLOWLIST`). Disallowed or missing tags fall back to `div`.

### Layout (RTF / DOCX)

For Affinity Publisher and similar tools that map **named paragraph styles**:

```ts
import {
  exportLayoutRtf,
  exportLayoutDocx,
  resolveLibraryStylePrefixStem,
} from "@orthodox-prayer-toolkit/core";

const stem = resolveLibraryStylePrefixStem(manifest);
const rtf = exportLayoutRtf(prayer, {
  lang: "de",
  variant: "standard",
  stylePrefixStem: stem,
});
const docx = await exportLayoutDocx(prayer, {
  lang: "de",
  variant: "standard",
  stylePrefixStem: stem,
});
```

Shared intermediate: `buildLayoutStory(...)`. Style name prefix defaults to `opt` (`DEFAULT_STYLE_PREFIX_STEM`).

See also [Affinity bridge](affinity-bridge.md).

## Kinds & variants across a library

```ts
import { indexKinds, indexVariants, renameKind, deleteKind } from "@orthodox-prayer-toolkit/core";

const kinds = indexKinds(prayers);
const variants = indexVariants(prayers);
const updated = renameKind(prayer, "old-kind", "new-kind");
```

`renameKind` / `deleteKind` operate on one prayer document (the app may apply renames across the open library with confirmation).

## Styles

```ts
import {
  resolveStyles,
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  validateStyles,
  sanitizeStyles,
} from "@orthodox-prayer-toolkit/core";

const styles = resolveStyles({
  discoveredKinds: kinds,
  appDefaults: DEFAULT_KIND_STYLES,
  libraryOverrides: libraryStyles,
});
```

Always validate untrusted `styles.json` before applying.

## Library helpers

```ts
import {
  prayerFilename,
  isPrayerFilename,
  findIdCollisions,
  filenameMatchesId,
  isLibraryManifest,
  normalizeLibraryManifest,
} from "@orthodox-prayer-toolkit/core";

prayerFilename("tropar-prokopios"); // "tropar-prokopios.json"
```

## Display title

```ts
import { resolveDisplayTitle } from "@orthodox-prayer-toolkit/core";

resolveDisplayTitle(prayer, { lang: "de", variant: "standard" });
```

## Inline text helpers

For editors that toggle note spans:

`toRuns`, `plainText`, `packInline`, `splitInline`, `markRangeAsNote`, `toggleNoteRange`, `unmarkRange`, …

## Types to know

| Type | Meaning |
|------|---------|
| `Prayer` | Canonical multilingual document |
| `FlatPrayer` | Single-variant export |
| `VariantMeta` | Registry entry |
| `Block` / `Translation` | Structure units |
| `KindStyle` / `StyleMap` | Typography tokens |
| `LibraryManifest` | Optional collection meta |
| `ValidationResult` | `ok` discriminant |

## Testing convention

Prefer golden fixtures against Core behaviour (valid/invalid docs, export output, kind unions, resolved styles). Do not re-test schema rules only in the React layer.

```bash
pnpm --filter @orthodox-prayer-toolkit/core test
```
