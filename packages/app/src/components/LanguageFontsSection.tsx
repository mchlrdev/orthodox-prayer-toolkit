import { useMemo, useState } from "react";
import { ActionIcon, Autocomplete, Group, Select, Slider, Stack, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { languageName } from "../languageName";
import {
  LANGUAGE_FONT_SIZE_MAX,
  LANGUAGE_FONT_SIZE_MIN,
  SAMPLE_LANGUAGES,
  languageSample,
  type LanguageFonts,
} from "../languageFontPrefs";

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

/** App settings: a font and size per language, for the editor's display only. */
export function LanguageFontsSection({
  fonts,
  onChange,
  languages,
}: {
  fonts: LanguageFonts;
  onChange: (fonts: LanguageFonts) => void;
  /** Languages of the open Prayer, offered first. */
  languages: string[];
}) {
  const { families, load } = useLocalFontFamilies();
  const addable = useMemo(() => {
    const open = [...new Set(languages)];
    const rest = SAMPLE_LANGUAGES.filter((l) => !open.includes(l)).sort((a, b) =>
      languageName(a).localeCompare(languageName(b)),
    );
    return [...open, ...rest]
      .filter((lang) => !fonts[lang])
      .map((lang) => ({ value: lang, label: languageName(lang) }));
  }, [languages, fonts]);

  const without = (lang: string) => Object.fromEntries(Object.entries(fonts).filter(([key]) => key !== lang));

  return (
    <Stack gap={8}>
      <Text size="sm" fw={600}>
        Font by language
      </Text>
      <Text size="xs" c="dimmed">
        Only how the editor shows the text. Exports and the prayer files stay as they are.
      </Text>
      {Object.entries(fonts).map(([lang, font]) => (
        <div key={lang} className="language-font">
          <Group justify="space-between" gap={8} wrap="nowrap">
            <Text size="xs" fw={500}>
              {languageName(lang)}
            </Text>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="xs"
              aria-label={`Remove the font for ${languageName(lang)}`}
              onClick={() => onChange(without(lang))}
            >
              <IconX size={12} />
            </ActionIcon>
          </Group>
          <Autocomplete
            size="xs"
            aria-label={`Font for ${languageName(lang)}`}
            placeholder="Prayer font"
            data={families}
            limit={50}
            value={font.family ?? ""}
            onFocus={load}
            onChange={(family) => {
              const { size } = font;
              onChange({ ...fonts, [lang]: family ? { family, size } : { size } });
            }}
          />
          <Group gap={10} wrap="nowrap">
            <Slider
              style={{ flex: 1 }}
              aria-label={`Size for ${languageName(lang)}`}
              min={LANGUAGE_FONT_SIZE_MIN}
              max={LANGUAGE_FONT_SIZE_MAX}
              step={5}
              label={null}
              value={font.size}
              onChange={(size) => onChange({ ...fonts, [lang]: { ...font, size } })}
            />
            <Text size="xs" c="dimmed" className="language-font-size">
              {font.size}%
            </Text>
          </Group>
          <div
            className="language-font-sample"
            dir="auto"
            lang={lang}
            style={{
              fontFamily: font.family ? `"${font.family.replace(/["\\]/g, "")}", var(--opt-prayer-font)` : undefined,
              fontSize: `calc(var(--opt-editor-font-size) * ${font.size / 100})`,
            }}
          >
            {languageSample(lang)}
          </div>
        </div>
      ))}
      <Select
        size="xs"
        aria-label="Add a language"
        placeholder="Add a language…"
        searchable
        data={addable}
        value={null}
        onChange={(lang) => {
          if (lang) onChange({ ...fonts, [lang]: { size: 100 } });
        }}
      />
    </Stack>
  );
}
