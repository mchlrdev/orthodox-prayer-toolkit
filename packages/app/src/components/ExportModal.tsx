import { useEffect, useMemo, useState } from "react";
import { IconArrowsLeftRight } from "@tabler/icons-react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Modal,
  Input,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  DEFAULT_PARALLEL_SPEAKER_EXPORT,
  HTML_TAG_ALLOWLIST,
  HTML_WRAPPER_TAG_ALLOWLIST,
  isValidStylePrefixStem,
  kindDisplayLabel,
  parseHtmlAttributes,
  resolveLibraryStylePrefixStem,
  tagMapFromStyles,
  type LibraryManifest,
  type ParallelSpeakerExportOptions,
  type Prayer,
  type SpeakerExportOptions,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import {
  pickExportParallelColumns,
  pickExportVariant,
} from "../session/exportPick";
import { resolveExportPrefixStem } from "../session/layoutPrefix";
import {
  presetFromSeparator,
  prayerHasSpeakers,
  separatorFromPreset,
  type SeparatorPreset,
} from "../session/exportPrayerVariant";
import type {
  ExportFormat,
  HtmlExportRequest,
  LayoutExportRequest,
  ParallelExportRequest,
} from "../session/exportPrayerVariant";
import {
  exportPrefsPatchFromForm,
  isExportFormat,
  loadExportPrefs,
  saveExportPrefs,
  type HtmlExportPrefs,
  type LayoutFormat,
  type ParallelSpeakerPlacement,
  type SpeakerForm,
  type SpeakerPlacement,
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
  /** HTML speaker options; omitted when the prayer has no speakers. */
  speakers?: Partial<SpeakerExportOptions>;
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
  const [gutterColumn, setGutterColumn] = useState(true);
  const [speakerGutterColumn, setSpeakerGutterColumn] = useState(true);
  const [speakerPlacement, setSpeakerPlacement] =
    useState<SpeakerPlacement>("inline");
  const [speakerParallelPlacement, setSpeakerParallelPlacement] =
    useState<ParallelSpeakerPlacement>(DEFAULT_PARALLEL_SPEAKER_EXPORT.placement);
  const [speakerForm, setSpeakerForm] = useState<SpeakerForm>("name");
  const [separatorPreset, setSeparatorPreset] =
    useState<SeparatorPreset>("colon");
  const [customSeparator, setCustomSeparator] = useState("");

  const hasSpeakers = useMemo(() => prayerHasSpeakers(prayer), [prayer]);

  const libraryResolvedStem = resolveLibraryStylePrefixStem(
    libraryManifest?.stylePrefixStem,
  );

  useEffect(() => {
    if (!opened) return;
    const saved = loadExportPrefs(libraryRoot, prayerPath);
    const pick = pickExportVariant(prayer, libraryDefault, saved?.variant);
    setVariantKeyValue(pick ? variantKey(pick) : "");
    setFormat(saved && isExportFormat(saved.format) ? saved.format : "flat-json");

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
    setGutterColumn(saved?.parallelGutterColumn !== false);
    setSpeakerGutterColumn(saved?.parallelSpeakerGutterColumn !== false);
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
    setSpeakerPlacement(saved?.speakerPlacement ?? "inline");
    setSpeakerParallelPlacement(
      saved?.speakerParallelPlacement ?? DEFAULT_PARALLEL_SPEAKER_EXPORT.placement,
    );
    setSpeakerForm(saved?.speakerForm ?? "name");
    const savedSep = saved?.speakerSeparator ?? ": ";
    const savedPreset = presetFromSeparator(savedSep);
    setSeparatorPreset(savedPreset);
    setCustomSeparator(savedPreset === "custom" ? savedSep : "");
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
    (!!left && !!right && !sameVariant(left, right) && selectData.length >= 2);
  const canExport =
    format === "docx-parallel"
      ? parallelReady && layoutReady
      : Boolean(selected) && selectData.length > 0 && htmlReady && layoutReady;

  const applyColumnChange = (side: "left" | "right", nextKey: string) => {
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

  const showSpeakers = hasSpeakers && format !== "flat-json";
  const allowColumn = format === "layout" && layoutFormat === "docx";
  const separatorValue =
    separatorPreset === "custom"
      ? customSeparator
      : separatorFromPreset(separatorPreset);

  const resetTagMap = () => {
    setTagMap(tagMapFromStyles(resolvedStyles));
  };

  const resetPrefixStem = () => {
    setPrefixStem(libraryResolvedStem);
  };

  const persistCurrentPrefs = () => {
    saveExportPrefs(
      libraryRoot,
      prayerPath,
      exportPrefsPatchFromForm({
        format,
        variant: selected,
        includeBlocksWithoutTranslation,
        html: {
          tagMap,
          wrapperEnabled,
          wrapperTag,
          wrapperAttributes,
        },
        layout: {
          layoutFormat,
          layoutPrefixStem: prefixStem,
        },
        parallelLeft: left,
        parallelRight: right,
        gutterColumn,
        speakerGutterColumn,
        speakers: {
          placement: speakerPlacement,
          parallelPlacement: speakerParallelPlacement,
          form: speakerForm,
          separator: separatorValue,
        },
      }),
    );
  };

  const handleClose = () => {
    persistCurrentPrefs();
    onClose();
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
              gutterColumn,
              speakerGutterColumn,
            }
          : undefined;

      let speakers: Partial<SpeakerExportOptions> | undefined;
      if (showSpeakers) {
        if (format === "docx-parallel" && parallel) {
          const ps: Partial<ParallelSpeakerExportOptions> = {
            placement: speakerParallelPlacement,
            form: speakerForm,
            separator: separatorValue,
          };
          parallel.speakers = ps;
        } else {
          // "column" only applies to layout DOCX; clamp elsewhere.
          const placement: SpeakerPlacement =
            speakerPlacement === "column" && !allowColumn
              ? "inline"
              : speakerPlacement;
          speakers = {
            placement,
            form: speakerForm,
            separator: separatorValue,
          };
          if (layout) layout.speakers = speakers;
        }
      }

      const variant = format === "docx-parallel" ? left! : selected!;
      const savedPath = await onExport({
        variant,
        format,
        includeBlocksWithoutTranslation:
          format === "docx-parallel" ? false : includeBlocksWithoutTranslation,
        html,
        layout,
        parallel,
        speakers: format === "html" ? speakers : undefined,
      });

      if (savedPath !== false) {
        handleClose();
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

  const speakersSection = showSpeakers ? (
    <Stack gap="sm">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
        Speakers
      </Text>
      <Input.Wrapper label="Placement">
        {format === "docx-parallel" ? (
          <SegmentedControl
            fullWidth
            size="xs"
            value={speakerParallelPlacement}
            onChange={(v) =>
              setSpeakerParallelPlacement(v as ParallelSpeakerPlacement)
            }
            data={[
              { label: "Inline left", value: "inline-left" },
              { label: "Inline both", value: "inline-both" },
              { label: "Own column", value: "column" },
              { label: "Off", value: "off" },
            ]}
          />
        ) : (
          <SegmentedControl
            fullWidth
            size="xs"
            value={
              speakerPlacement === "column" && !allowColumn
                ? "inline"
                : speakerPlacement
            }
            onChange={(v) => setSpeakerPlacement(v as SpeakerPlacement)}
            data={
              allowColumn
                ? [
                    { label: "Inline", value: "inline" },
                    { label: "Own column", value: "column" },
                    { label: "Off", value: "off" },
                  ]
                : [
                    { label: "Inline", value: "inline" },
                    { label: "Off", value: "off" },
                  ]
            }
          />
        )}
      </Input.Wrapper>
      {format === "docx-parallel" &&
      speakerParallelPlacement === "column" ? (
        <Checkbox
          label="Add empty column after Speaker"
          checked={speakerGutterColumn}
          onChange={(e) => setSpeakerGutterColumn(e.currentTarget.checked)}
        />
      ) : null}
      <Input.Wrapper label="Label">
        <SegmentedControl
          fullWidth
          size="xs"
          value={speakerForm}
          onChange={(v) => setSpeakerForm(v as SpeakerForm)}
          data={[
            { label: "Name", value: "name" },
            { label: "Short", value: "short" },
          ]}
        />
      </Input.Wrapper>
      <Input.Wrapper label="Separator">
        <Stack gap="xs">
          <SegmentedControl
            fullWidth
            size="xs"
            value={separatorPreset}
            onChange={(v) => setSeparatorPreset(v as SeparatorPreset)}
            data={[
              { label: ":", value: "colon" },
              { label: ".", value: "dot" },
              { label: "none", value: "none" },
              { label: "Custom", value: "custom" },
            ]}
          />
          {separatorPreset === "custom" ? (
            <TextInput
              size="xs"
              aria-label="Custom separator"
              placeholder="e.g. —"
              value={customSeparator}
              onChange={(e) => setCustomSeparator(e.currentTarget.value)}
            />
          ) : null}
        </Stack>
      </Input.Wrapper>
    </Stack>
  ) : null;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
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
                    attrParse.ok ? undefined : attrParse.errors.join(" · ")
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
            <Checkbox
              mt="sm"
              label="Add empty middle column"
              checked={gutterColumn}
              onChange={(e) => setGutterColumn(e.currentTarget.checked)}
            />
          </Stack>
        ) : null}

        {format !== "docx-parallel" ? (
          <Checkbox
            label="Include blocks without translation"
            mt="xs"
            mb="sm"
            checked={includeBlocksWithoutTranslation}
            onChange={(e) =>
              setIncludeBlocksWithoutTranslation(e.currentTarget.checked)
            }
          />
        ) : null}

        {speakersSection}

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
            onClick={handleClose}
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
