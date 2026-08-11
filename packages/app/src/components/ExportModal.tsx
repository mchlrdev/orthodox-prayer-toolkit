import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  HTML_TAG_ALLOWLIST,
  HTML_WRAPPER_TAG_ALLOWLIST,
  isValidStylePrefixStem,
  parseHtmlAttributes,
  resolveLibraryStylePrefixStem,
  tagMapFromStyles,
  type LibraryManifest,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { pickExportVariant } from "../session/exportPick";
import { resolveExportPrefixStem } from "../session/layoutPrefix";
import type {
  ExportFormat,
  HtmlExportRequest,
  LayoutExportRequest,
} from "../session/exportPrayerVariant";
import {
  loadExportPrefs,
  saveExportPrefs,
  type HtmlExportPrefs,
  type LayoutFormat,
} from "../exportPrefs";
import {
  parseVariantKey,
  variantKey,
  variantLabel,
  type ActiveVariant,
} from "../variant";

export type { ExportFormat };

export type ExportPayload = {
  variant: ActiveVariant;
  format: ExportFormat;
  includeBlocksWithoutTranslation: boolean;
  html?: HtmlExportRequest;
  layout?: LayoutExportRequest;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  prayer: Prayer;
  /** Absolute path of the prayer within the library (for prefs). */
  prayerPath: string;
  libraryRoot: string;
  resolvedStyles: StyleMap;
  libraryManifest?: LibraryManifest | null;
  /** Library default language from manifest settings. */
  libraryDefault?: ActiveVariant;
  busy?: boolean;
  /** Return the saved path, `null` if cancelled, or `false` on failure. */
  onExport: (
    payload: ExportPayload,
  ) => string | null | false | void | Promise<string | null | false | void>;
};

function kindsForMap(prayer: Prayer, styles: StyleMap): string[] {
  const kinds = new Set<string>([
    ...prayer.structure.map((b) => b.kind),
    ...Object.keys(styles),
  ]);
  return [...kinds].sort((a, b) => a.localeCompare(b));
}

function defaultHtmlPrefs(styles: StyleMap): HtmlExportPrefs {
  return {
    tagMap: tagMapFromStyles(styles),
    wrapperEnabled: false,
    wrapperTag: "article",
    wrapperAttributes: "",
  };
}

export function ExportModal({
  opened,
  onClose,
  prayer,
  prayerPath,
  libraryRoot,
  resolvedStyles,
  libraryManifest,
  libraryDefault,
  busy = false,
  onExport,
}: Props) {
  const [variantKeyValue, setVariantKeyValue] = useState("");
  const [format, setFormat] = useState<ExportFormat>("flat-json");
  const [exporting, setExporting] = useState(false);
  const [includeBlocksWithoutTranslation, setIncludeBlocksWithoutTranslation] =
    useState(false);
  const [tagMap, setTagMap] = useState<Record<string, string>>({});
  const [wrapperEnabled, setWrapperEnabled] = useState(false);
  const [wrapperTag, setWrapperTag] = useState("article");
  const [wrapperAttributes, setWrapperAttributes] = useState("");
  const [layoutFormat, setLayoutFormat] = useState<LayoutFormat>("docx");
  const [prefixStem, setPrefixStem] = useState("opt");

  const libraryResolvedStem = resolveLibraryStylePrefixStem(
    libraryManifest?.stylePrefixStem,
  );

  useEffect(() => {
    if (!opened) return;
    const pick = pickExportVariant(prayer, libraryDefault);
    setVariantKeyValue(pick ? variantKey(pick) : "");
    setFormat("flat-json");

    const saved = loadExportPrefs(libraryRoot, prayerPath);
    const defaults = defaultHtmlPrefs(resolvedStyles);
    setIncludeBlocksWithoutTranslation(
      saved?.includeBlocksWithoutTranslation ?? false,
    );
    setTagMap({ ...(saved?.tagMap ?? defaults.tagMap) });
    setWrapperEnabled(saved?.wrapperEnabled ?? defaults.wrapperEnabled);
    setWrapperTag(saved?.wrapperTag ?? defaults.wrapperTag);
    setWrapperAttributes(
      saved?.wrapperAttributes ?? defaults.wrapperAttributes,
    );
    setLayoutFormat(saved?.layoutFormat ?? "docx");
    setPrefixStem(
      resolveExportPrefixStem({
        prefsStem: saved?.layoutPrefixStem,
        hasPrefsStem: saved !== null && saved.layoutPrefixStem !== undefined,
        libraryManifest,
      }),
    );
    // Prefill only when opening; live draft edits must not reset the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened gate
  }, [opened]);

  const selectData = useMemo(
    () =>
      prayer.variants
        .map((v) => ({
          value: variantKey(v),
          label: variantLabel(v),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [prayer.variants],
  );

  const kindRows = useMemo(
    () => kindsForMap(prayer, resolvedStyles),
    [prayer, resolvedStyles],
  );

  const attrParse = useMemo(
    () => parseHtmlAttributes(wrapperAttributes),
    [wrapperAttributes],
  );

  const selected = parseVariantKey(variantKeyValue);
  const stemValid = isValidStylePrefixStem(prefixStem);
  const htmlReady =
    format !== "html" ||
    !wrapperEnabled ||
    (attrParse.ok &&
      HTML_WRAPPER_TAG_ALLOWLIST.includes(
        wrapperTag as (typeof HTML_WRAPPER_TAG_ALLOWLIST)[number],
      ));
  const layoutReady = format !== "layout" || stemValid;
  const canExport =
    Boolean(selected) &&
    selectData.length > 0 &&
    htmlReady &&
    layoutReady;

  const resetTagMap = () => {
    setTagMap(tagMapFromStyles(resolvedStyles));
  };

  const resetPrefixStem = () => {
    setPrefixStem(libraryResolvedStem);
  };

  const handleExport = async () => {
    if (!selected || !htmlReady || !layoutReady) return;
    setExporting(true);
    try {
      const html: HtmlExportRequest | undefined =
        format === "html"
          ? {
              tagMap,
              wrapperEnabled,
              wrapperTag,
              wrapperAttributes,
            }
          : undefined;

      const layout: LayoutExportRequest | undefined =
        format === "layout"
          ? {
              layoutFormat,
              prefixStem,
            }
          : undefined;

      const savedPath = await onExport({
        variant: selected,
        format,
        includeBlocksWithoutTranslation,
        html,
        layout,
      });

      if (savedPath) {
        saveExportPrefs(libraryRoot, prayerPath, {
          includeBlocksWithoutTranslation,
          html:
            format === "html" && html
              ? {
                  tagMap: html.tagMap,
                  wrapperEnabled: html.wrapperEnabled,
                  wrapperTag: html.wrapperTag,
                  wrapperAttributes: html.wrapperAttributes,
                }
              : undefined,
          layout:
            format === "layout" && layout
              ? {
                  layoutFormat: layout.layoutFormat,
                  layoutPrefixStem: layout.prefixStem,
                }
              : undefined,
        });
      }

      if (savedPath !== false) {
        onClose();
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Export"
      size="md"
      autoFocus={false}
    >
      <Stack gap="sm">
        <Select
          label="Language"
          placeholder={
            selectData.length === 0
              ? "No languages on this prayer"
              : "Select language"
          }
          data={selectData}
          value={variantKeyValue || null}
          onChange={(value) => setVariantKeyValue(value ?? "")}
          searchable
          nothingFoundMessage="No matching language"
          disabled={selectData.length === 0}
        />

        <Select
          label="Format"
          data={[
            { value: "flat-json", label: "Flat JSON" },
            { value: "html", label: "HTML" },
            { value: "layout", label: "Layout" },
          ]}
          value={format}
          onChange={(value) => {
            if (value === "flat-json" || value === "html" || value === "layout") {
              setFormat(value);
            }
          }}
          allowDeselect={false}
        />

        {format === "html" ? (
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end">
              <Text size="sm" fw={500}>
                Kind → HTML tag
              </Text>
              <Button variant="subtle" size="compact-xs" onClick={resetTagMap}>
                Reset tags
              </Button>
            </Group>
            <Stack gap="xs">
              {kindRows.map((kind) => (
                <Select
                  key={kind}
                  label={kind}
                  size="xs"
                  data={HTML_TAG_ALLOWLIST.map((tag) => ({
                    value: tag,
                    label: tag,
                  }))}
                  value={tagMap[kind] ?? "div"}
                  onChange={(v) => {
                    if (!v) return;
                    setTagMap((prev) => ({ ...prev, [kind]: v }));
                  }}
                  allowDeselect={false}
                />
              ))}
            </Stack>

            <Checkbox
              label="Wrap in root element"
              checked={wrapperEnabled}
              onChange={(e) => setWrapperEnabled(e.currentTarget.checked)}
            />

            {wrapperEnabled ? (
              <>
                <Select
                  label="Wrapper tag"
                  data={HTML_WRAPPER_TAG_ALLOWLIST.map((tag) => ({
                    value: tag,
                    label: tag,
                  }))}
                  value={wrapperTag}
                  onChange={(v) => v && setWrapperTag(v)}
                  allowDeselect={false}
                />
                <Textarea
                  label="Wrapper attributes"
                  placeholder='class="prayer"'
                  value={wrapperAttributes}
                  onChange={(e) => setWrapperAttributes(e.currentTarget.value)}
                  autosize
                  minRows={2}
                  error={
                    attrParse.ok
                      ? undefined
                      : attrParse.errors.join(" · ")
                  }
                />
              </>
            ) : null}
          </Stack>
        ) : null}

        {format === "layout" ? (
          <Stack gap="sm">
            <div>
              <Text size="sm" fw={500} mb={6}>
                File type
              </Text>
              <SegmentedControl
                fullWidth
                value={layoutFormat}
                onChange={(v) => {
                  if (v === "docx" || v === "rtf") setLayoutFormat(v);
                }}
                data={[
                  { label: "DOCX", value: "docx" },
                  { label: "RTF", value: "rtf" },
                ]}
              />
            </div>

            <Group align="flex-end" gap="xs" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                label="Style prefix"
                value={prefixStem}
                onChange={(e) => setPrefixStem(e.currentTarget.value)}
                rightSection={
                  <Text size="sm" c="dimmed" pr="xs">
                    _
                  </Text>
                }
                rightSectionPointerEvents="none"
                error={
                  stemValid
                    ? undefined
                    : "Use letters/digits only, starting with a letter — or leave empty"
                }
              />
              <Button
                variant="subtle"
                size="compact-sm"
                mb={stemValid ? 0 : 22}
                onClick={resetPrefixStem}
              >
                Reset
              </Button>
            </Group>
          </Stack>
        ) : null}

        <Checkbox
          label="Include blocks without translation"
          checked={includeBlocksWithoutTranslation}
          onChange={(e) =>
            setIncludeBlocksWithoutTranslation(e.currentTarget.checked)
          }
        />

        {selectData.length === 0 ? (
          <Text size="xs" c="dimmed">
            Add a language in prayer settings before exporting.
          </Text>
        ) : null}

        <Group justify="flex-end" mt="xs">
          <Button
            variant="default"
            onClick={onClose}
            disabled={exporting || busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleExport()}
            loading={exporting || busy}
            disabled={!canExport}
          >
            Export
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
