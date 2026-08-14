import { useMemo, type Ref } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconColumns2,
  IconDownload,
  IconPalette,
  IconPlus,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import {
  resolveDisplayTitle,
  type Prayer,
  type StyleMap,
  type VariantMeta,
} from "@orthodox-prayer-toolkit/core";
import { InlineEditor, type InlineEditorHandle } from "./InlineEditor";
import {
  parseVariantKey,
  sameVariant,
  variantKey,
  variantLabel,
  type ActiveVariant,
} from "../variant";

type StyleEditing = {
  resolved: StyleMap;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
  target: "app" | "library";
  onTargetChange: (t: "app" | "library") => void;
  libraryEnabled: boolean;
  onChangeApp: (next: StyleMap) => void;
  onChangeLibrary: (next: StyleMap) => void;
};

type Props = {
  prayer: Prayer;
  visibleVariants: ActiveVariant[];
  styles: StyleMap;
  styleEditing: StyleEditing;
  busy: boolean;
  dirty: boolean;
  editorRef?: Ref<InlineEditorHandle>;
  scrollRootRef?: Ref<HTMLDivElement | null>;
  onChange: (prayer: Prayer) => void;
  onVisibleVariantsChange: (cols: ActiveVariant[]) => void;
  onSave: () => void;
  onSettings: () => void;
  onStyles: () => void;
  onExport: () => void;
  onRenameKind: (from: string, to: string) => void;
};

function metaFor(
  prayer: Prayer,
  col: ActiveVariant,
): VariantMeta | undefined {
  return prayer.variants.find((v) => sameVariant(v, col));
}

function ColumnChip({
  meta,
  col,
  canRemove,
  options,
  onReplace,
  onRemove,
}: {
  meta: VariantMeta | undefined;
  col: ActiveVariant;
  canRemove: boolean;
  options: { value: string; label: string }[];
  onReplace: (next: ActiveVariant) => void;
  onRemove: () => void;
}) {
  const title = meta?.title ?? variantLabel(col);
  const short = variantLabel(col);

  return (
    <div className="split-chip" data-interactive="true">
      <Menu shadow="md" width={240} position="bottom-start" withinPortal>
        <Menu.Target>
          <button type="button" className="split-chip-main" title={title}>
            <span className="split-chip-lang">{col.lang}</span>
            <span className="split-chip-sep">/</span>
            <span className="split-chip-variant">{col.variant}</span>
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Switch column</Menu.Label>
          {options.map((opt) => {
            const parsed = parseVariantKey(opt.value);
            const active = parsed ? sameVariant(parsed, col) : false;
            return (
              <Menu.Item
                key={opt.value}
                disabled={active}
                onClick={() => {
                  if (!parsed || active) return;
                  onReplace(parsed);
                }}
              >
                {opt.label}
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
      {canRemove ? (
        <Tooltip label="Remove column" withArrow openDelay={400}>
          <button
            type="button"
            className="split-chip-remove"
            aria-label={`Remove ${short}`}
            onClick={onRemove}
          >
            <IconX size={12} stroke={2.2} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function PrayerWorkspace({
  prayer,
  visibleVariants,
  styles,
  styleEditing,
  busy,
  dirty,
  editorRef,
  scrollRootRef,
  onChange,
  onVisibleVariantsChange,
  onSave,
  onSettings,
  onStyles,
  onExport,
  onRenameKind,
}: Props) {
  const split = visibleVariants.length > 1;

  const availableToAdd = useMemo(() => {
    return prayer.variants.filter(
      (v) => !visibleVariants.some((col) => sameVariant(col, v)),
    );
  }, [prayer.variants, visibleVariants]);

  const allOptions = useMemo(
    () =>
      prayer.variants.map((v) => ({
        value: variantKey(v),
        label: `${v.lang} / ${v.variant}${v.title ? ` — ${v.title}` : ""}`,
      })),
    [prayer.variants],
  );

  const replaceColumn = (index: number, next: ActiveVariant) => {
    // Avoid duplicate columns: if next already shown elsewhere, swap.
    const existing = visibleVariants.findIndex((c) => sameVariant(c, next));
    const cols = [...visibleVariants];
    if (existing >= 0 && existing !== index) {
      const tmp = cols[index]!;
      cols[index] = cols[existing]!;
      cols[existing] = tmp;
    } else {
      cols[index] = next;
    }
    onVisibleVariantsChange(cols);
  };

  const removeColumn = (index: number) => {
    if (visibleVariants.length <= 1) return;
    onVisibleVariantsChange(visibleVariants.filter((_, i) => i !== index));
  };

  const addColumn = (next: ActiveVariant) => {
    if (visibleVariants.some((c) => sameVariant(c, next))) return;
    onVisibleVariantsChange([...visibleVariants, next]);
  };

  const showAll = () => {
    onVisibleVariantsChange(
      prayer.variants.map((v) => ({ lang: v.lang, variant: v.variant })),
    );
  };

  const headerTitle = resolveDisplayTitle(prayer, visibleVariants[0] ?? null);

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div className="workspace-header-top">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <h1 className="workspace-title">{headerTitle}</h1>
            {dirty ? (
              <Badge size="sm" color="accent" variant="light">
                Unsaved
              </Badge>
            ) : null}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Settings" withArrow openDelay={300}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Settings"
                onClick={onSettings}
              >
                <IconSettings size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Styles" withArrow openDelay={300}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Styles"
                onClick={onStyles}
              >
                <IconPalette size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Export" withArrow openDelay={300}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Export"
                onClick={onExport}
              >
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
            <Button size="xs" loading={busy} onClick={onSave} disabled={!dirty}>
              Save
            </Button>
          </Group>
        </div>

        {prayer.variants.length > 1 ? (
          <div
            className="workspace-split-bar"
            data-split={split ? "true" : undefined}
          >
            <div className="split-chip-row">
              {visibleVariants.map((col, index) => (
                <ColumnChip
                  key={`${variantKey(col)}-${index}`}
                  meta={metaFor(prayer, col)}
                  col={col}
                  canRemove={visibleVariants.length > 1}
                  options={allOptions}
                  onReplace={(next) => replaceColumn(index, next)}
                  onRemove={() => removeColumn(index)}
                />
              ))}

              {availableToAdd.length > 0 ? (
                <Menu
                  shadow="md"
                  width={260}
                  position="bottom-start"
                  withinPortal
                >
                  <Menu.Target>
                    <button
                      type="button"
                      className="split-add"
                      aria-label="Add translation column"
                    >
                      <IconPlus size={14} stroke={2.2} />
                      <span>Add</span>
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Add translation</Menu.Label>
                    {availableToAdd.map((v) => (
                      <Menu.Item
                        key={variantKey(v)}
                        onClick={() =>
                          addColumn({ lang: v.lang, variant: v.variant })
                        }
                      >
                        <Text size="sm" fw={500}>
                          {v.lang} / {v.variant}
                        </Text>
                        {v.title ? (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {v.title}
                          </Text>
                        ) : null}
                      </Menu.Item>
                    ))}
                    {availableToAdd.length > 1 ? (
                      <>
                        <Menu.Divider />
                        <Menu.Item
                          leftSection={<IconColumns2 size={14} />}
                          onClick={showAll}
                        >
                          Show all
                        </Menu.Item>
                      </>
                    ) : null}
                  </Menu.Dropdown>
                </Menu>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="workspace-body" ref={scrollRootRef}>
        <div className="workspace-body-inner" data-split={split ? "true" : undefined}>
          <InlineEditor
            ref={editorRef}
            prayer={prayer}
            visibleVariants={visibleVariants}
            styles={styles}
            styleEditing={styleEditing}
            onChange={onChange}
            onRenameKind={onRenameKind}
          />
        </div>
      </div>
    </div>
  );
}
