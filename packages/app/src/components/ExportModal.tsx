import { useEffect, useMemo, useState } from "react";
import { IconArrowsLeftRight } from "@tabler/icons-react";
import {
  ActionIcon,
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
  Tooltip,
} from "@mantine/core";
import {
  HTML_TAG_ALLOWLIST,
  HTML_WRAPPER_TAG_ALLOWLIST,
  isValidStylePrefixStem,
  kindDisplayLabel,
  parseHtmlAttributes,
  resolveLibraryStylePrefixStem,
  tagMapFromStyles,
  type LibraryManifest,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import {
  pickExportParallelColumns,
  pickExportVariant,
} from "../session/exportPick";
import { resolveExportPrefixStem } from "../session/layoutPrefix";
import type {
  ExportFormat,
  HtmlExportRequest,
  LayoutExportRequest,
  ParallelExportRequest,
} from "../session/exportPrayerVariant";
import {
  loadExportPrefs,
  saveExportPrefs,
  type HtmlExportPrefs,
  type LayoutFormat,
} from "../exportPrefs";
import {
  parseVariantKey,
  sameVariant,
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
  parallel?: ParallelExportRequest;
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
  /** Visible editor columns; prefills Word table left/right when two are shown. */
  visibleVariants?: ActiveVariant[];
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
  visibleVariants = [],
  busy = false,
  onExport,
}: Props) {
  const [variantKeyValue, setVariantKeyValue] = useState("");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
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
    const savedPair =
      saved?.parallelLeft && saved?.parallelRight
        ? { left: saved.parallelLeft, right: saved.parallelRight }
        : null;
    const pair = pickExportParallelColumns(prayer, {
      libraryDefault,
      visible: visibleVariants,
      saved: savedPair,
    });
    setLeftKey(pair ? variantKey(pair[0]) : "");
    setRightKey(pair ? variantKey(pair[1]) : "");
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
  const left = parseVariantKey(leftKey);
  const right = parseVariantKey(rightKey);
  const stemValid = isValidStylePrefixStem(prefixStem);
  const htmlReady =
    format !== "html" ||
    !wrapperEnabled ||
    (attrParse.ok &&
      HTML_WRAPPER_TAG_ALLOWLIST.includes(
        wrapperTag as (typeof HTML_WRAPPER_TAG_ALLOWLIST)[number],
      ));
  const usesPrefix = format === "layout" || format === "docx-parallel";
  const layoutReady = !usesPrefix || stemValid;
  const parallelReady =
    format !== "docx-parallel" ||
    (!!left &&
      !!right &&
      !sameVariant(left, right) &&
      selectData.length >= 2);
  const canExport =
    format === "docx-parallel"
      ? parallelReady && layoutReady
      : Boolean(selected) &&
        selectData.length > 0 &&
        htmlReady &&
        layoutReady;

  const applyColumnChange = (
    side: "left" | "right",
    nextKey: string,
  ) => {
    const next = parseVariantKey(nextKey);
    if (side === "left") {
      if (next && right && sameVariant(next, right)) {
        setRightKey(leftKey);
      }
      setLeftKey(nextKey);
      return;
    }
    if (next && left && sameVariant(next, left)) {
      setLeftKey(rightKey);
    }
    setRightKey(nextKey);
  };

  const swapColumns = () => {
    setLeftKey(rightKey);
    setRightKey(leftKey);
  };

  const resetTagMap = () => {
    setTagMap(tagMapFromStyles(resolvedStyles));
  };

  const resetPrefixStem = () => {
    setPrefixStem(libraryResolvedStem);
  };

  const handleExport = async () => {
    if (format === "docx-parallel") {
      if (!left || !right || !parallelReady || !layoutReady) return;
    } else if (!selected || !htmlReady || !layoutReady) {
      return;
    }
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

      const parallel: ParallelExportRequest | undefined =
        format === "docx-parallel" && left && right
          ? {
              columns: [left, right],
              prefixStem,
            }
          : undefined;

      const variant = format === "docx-parallel" ? left! : selected!;
      const savedPath = await onExport({
        variant,
        format,
        includeBlocksWithoutTranslation,
        html,
        layout,
        parallel,
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
              : format === "docx-parallel"
                ? {
                    layoutFormat: "docx",
                    layoutPrefixStem: prefixStem,
                  }
                : undefined,
          parallel:
            format === "docx-parallel" && left && right
              ? { left, right }
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

  const prefixField = (
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
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Export"
      size="md"
      autoFocus={false}
    >
      <Stack gap="sm">
        {format !== "docx-parallel" ? (
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
        ) : null}

        <Select
          label="Format"
          data={[
            { value: "flat-json", label: "Flat JSON" },
            { value: "html", label: "HTML" },
            { value: "layout", label: "Layout" },
            { value: "docx-parallel", label: "Word table" },
          ]}
          value={format}
          onChange={(value) => {
            if (
              value === "flat-json" ||
              value === "html" ||
              value === "layout" ||
              value === "docx-parallel"
            ) {
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
                  label={kindDisplayLabel(kind)}
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
            {prefixField}
          </Stack>
        ) : null}

        {format === "docx-parallel" ? (
          <Stack gap="sm">
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Select
                style={{ flex: 1 }}
                label="Left"
                placeholder={
                  selectData.length < 2
                    ? "Need two languages"
                    : "Select language"
                }
                data={selectData}
                value={leftKey || null}
                onChange={(value) => applyColumnChange("left", value ?? "")}
                searchable
                nothingFoundMessage="No matching language"
                disabled={selectData.length < 2}
              />
              <Tooltip label="Swap columns" withArrow>
                <ActionIcon
                  variant="default"
                  size="lg"
                  mb={1}
                  aria-label="Swap columns"
                  onClick={swapColumns}
                  disabled={selectData.length < 2 || !leftKey || !rightKey}
                >
                  <IconArrowsLeftRight size={16} />
                </ActionIcon>
              </Tooltip>
              <Select
                style={{ flex: 1 }}
                label="Right"
                placeholder={
                  selectData.length < 2
                    ? "Need two languages"
                    : "Select language"
                }
                data={selectData}
                value={rightKey || null}
                onChange={(value) => applyColumnChange("right", value ?? "")}
                searchable
                nothingFoundMessage="No matching language"
                disabled={selectData.length < 2}
              />
            </Group>
            {prefixField}
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
        ) : format === "docx-parallel" && selectData.length < 2 ? (
          <Text size="xs" c="dimmed">
            Add a second language in prayer settings before exporting a Word
            table.
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
