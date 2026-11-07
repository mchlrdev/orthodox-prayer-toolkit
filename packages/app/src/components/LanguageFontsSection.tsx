import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Accordion,
  Autocomplete,
  Button,
  Group,
  Slider,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { IndexedVariant, Prayer } from "@orthodox-prayer-toolkit/core";
import {
  VARIANT_FONT_SIZE_MAX,
  VARIANT_FONT_SIZE_MIN,
  variantSamples,
  type VariantFont,
  type VariantFonts,
} from "../languageFontPrefs";
import {
  parseVariantKey,
  variantKey,
  variantLabel,
  type ActiveVariant,
} from "../variant";

const UNCHANGED: VariantFont = { size: 100 };

type LocalFonts = () => Promise<{ family: string }[]>;

/** Installed font families, or nothing where the platform will not list them; names can be typed too. */
function useLocalFontFamilies() {
  const [families, setFamilies] = useState<string[]>([]);
  const load = () => {
    if (families.length > 0) return;
    const query = (window as unknown as { queryLocalFonts?: LocalFonts }).queryLocalFonts;
    if (!query) return;
    void query.call(window).then(
      (fonts) => setFamilies([...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))),
      () => undefined,
    );
  };
  return { families, load };
}

function VariantFontRow({
  variant,
  font,
  sample,
  action,
  families,
  onFontsFocus,
  onChange,
  focusRequest,
}: {
  variant: ActiveVariant;
  font: VariantFont;
  sample: string | undefined;
  action: ReactNode;
  families: string[];
  onFontsFocus: () => void;
  onChange: (font: VariantFont) => void;
  /** Goes up when "Add language" names this Variant. */
  focusRequest: number;
}) {
  const label = variantLabel(variant);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);

  return (
    <div className="language-font">
      <Group justify="space-between" gap={8} wrap="nowrap" mih={22}>
        <Text size="xs" fw={500}>
          {label}
        </Text>
        {action}
      </Group>
      <Autocomplete
        ref={input}
        size="xs"
        aria-label={`Font for ${label}`}
        placeholder="Prayer font"
        data={families}
        limit={50}
        value={font.family ?? ""}
        onFocus={onFontsFocus}
        onChange={(family) => {
          const { size } = font;
          onChange(family ? { family, size } : { size });
        }}
      />
      <Group gap={10} wrap="nowrap">
        <Slider
          style={{ flex: 1 }}
          aria-label={`Size for ${label}`}
          min={VARIANT_FONT_SIZE_MIN}
          max={VARIANT_FONT_SIZE_MAX}
          step={5}
          label={null}
          value={font.size}
          onChange={(size) => onChange({ ...font, size })}
        />
        <Text size="xs" c="dimmed" className="language-font-size">
          {font.size}%
        </Text>
      </Group>
      {sample ? (
        <div
          className="language-font-sample"
          dir="auto"
          lang={variant.lang}
          style={{
            fontFamily: font.family ? `"${font.family.replace(/["\\]/g, "")}", var(--opt-prayer-font)` : undefined,
            fontSize: `calc(var(--opt-editor-font-size) * ${font.size / 100})`,
          }}
        >
          {sample}
        </div>
      ) : null}
    </div>
  );
}

/**
 * App settings: a font and size per Variant, for the editor's display only.
 * Variants come from the open Library; the app keeps no list of its own.
 */
export function LanguageFontsSection({
  fonts,
  onChange,
  libraryVariants,
  openPrayer,
}: {
  fonts: VariantFonts;
  onChange: (fonts: VariantFonts) => void;
  /** Variants of the open Library and open drafts. */
  libraryVariants: IndexedVariant[];
  openPrayer: Prayer | null;
}) {
  const { families, load } = useLocalFontFamilies();
  const [lang, setLang] = useState("");
  const [edition, setEdition] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [focus, setFocus] = useState({ key: "", request: 0 });

  const samples = useMemo(() => variantSamples(openPrayer), [openPrayer]);
  const detectedKeys = useMemo(() => new Set(libraryVariants.map(variantKey)), [libraryVariants]);
  const others = Object.keys(fonts)
    .filter((key) => !detectedKeys.has(key))
    .sort((a, b) => a.localeCompare(b));

  const without = (key: string) => Object.fromEntries(Object.entries(fonts).filter(([k]) => k !== key));
  const isChanged = (font: VariantFont) => Boolean(font.family) || font.size !== UNCHANGED.size;

  const row = (key: string, variant: ActiveVariant, action: ReactNode, onRowChange: (font: VariantFont) => void) => (
    <VariantFontRow
      key={key}
      variant={variant}
      font={fonts[key] ?? UNCHANGED}
      sample={samples.get(key)}
      action={action}
      families={families}
      onFontsFocus={load}
      onChange={onRowChange}
      focusRequest={focus.key === key ? focus.request : 0}
    />
  );

  const otherRows = others.map((key) => {
    const variant = parseVariantKey(key);
    if (!variant) return null;
    return row(
      key,
      variant,
      <Button
        size="compact-xs"
        variant="subtle"
        color="accent"
        leftSection={<IconTrash size={12} />}
        aria-label={`Remove the font for ${variantLabel(variant)}`}
        onClick={() => onChange(without(key))}
      >
        Remove
      </Button>,
      // Stays when unchanged: it was entered ahead of time and has no row otherwise.
      (font) => onChange({ ...fonts, [key]: font }),
    );
  });

  const add = (e: FormEvent) => {
    e.preventDefault();
    const variant = { lang: lang.trim(), variant: edition.trim() };
    if (!variant.lang || !variant.variant) return;
    const key = variantKey(variant);
    if (!fonts[key] && !detectedKeys.has(key)) onChange({ ...fonts, [key]: UNCHANGED });
    if (!detectedKeys.has(key)) setOtherOpen(true);
    setFocus((prev) => ({ key, request: prev.request + 1 }));
    setLang("");
    setEdition("");
  };

  return (
    <Stack gap={8}>
      <Text size="sm" fw={600}>
        Display font for languages
      </Text>
      {libraryVariants.map((variant) => {
        const key = variantKey(variant);
        const font = fonts[key];
        return row(
          key,
          variant,
          font ? (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              aria-label={`Reset the font for ${variantLabel(variant)}`}
              onClick={() => onChange(without(key))}
            >
              Reset
            </Button>
          ) : null,
          // Only what differs is stored.
          (next) => onChange(isChanged(next) ? { ...fonts, [key]: next } : without(key)),
        );
      })}
      {libraryVariants.length === 0 ? (
        others.length > 0 ? (
          otherRows
        ) : (
          <Text size="xs" c="dimmed">
            No variants found yet. Add one below to choose its font ahead of time.
          </Text>
        )
      ) : others.length > 0 ? (
        <Accordion
          className="settings-accordion"
          variant="separated"
          radius="md"
          transitionDuration={0}
          value={otherOpen ? "other" : null}
          onChange={(value) => setOtherOpen(value === "other")}
        >
          <Accordion.Item value="other">
            <Accordion.Control>
              <Text size="xs" fw={500}>
                Not in this library ({others.length})
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap={8}>{otherRows}</Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : null}
      <form onSubmit={add}>
        <Stack gap={8} mt={8}>
          <Group grow align="flex-start">
            <TextInput
              size="xs"
              label="Language Code"
              value={lang}
              onChange={(e) => setLang(e.currentTarget.value)}
            />
            <TextInput
              size="xs"
              label="Edition"
              value={edition}
              onChange={(e) => setEdition(e.currentTarget.value)}
            />
          </Group>
          <Button
            type="submit"
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            disabled={!lang.trim() || !edition.trim()}
            style={{ alignSelf: "flex-start" }}
          >
            Add language
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
