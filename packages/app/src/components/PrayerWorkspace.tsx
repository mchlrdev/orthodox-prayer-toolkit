import { useCallback, useMemo, useRef, type Ref } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Popover,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconColumns2,
  IconDownload,
  IconPlus,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import {
  locateValidationErrors,
  resolveDisplayTitle,
  type Prayer,
  type StyleMap,
  type ValidationError,
  type VariantMeta,
} from "@orthodox-prayer-toolkit/core";
import {
  InlineEditor,
  type BlockIssues,
  type InlineEditorHandle,
} from "./InlineEditor";
import { shortcutLabel } from "../appCommands";
import type { DiskConflict } from "../session";
import { FindReplacePanel } from "./FindReplacePanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { usePrayerScroll } from "../prayerScroll";
import { useFindReplace } from "../findReplace/useFindReplace";
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
  libraryEnabled: boolean;
  onChangeApp: (next: StyleMap) => void;
  onChangeLibrary: (next: StyleMap) => void;
};

type Props = {
  prayer: Prayer;
  prayerPath: string;
  libraryRoot: string;
  visibleVariants: ActiveVariant[];
  styles: StyleMap;
  styleEditing: StyleEditing;
  busy: boolean;
  dirty: boolean;
  /** Live validation of the session draft. */
  errors: ValidationError[];
  diskConflict: DiskConflict | null;
  editorRef?: Ref<InlineEditorHandle>;
  scrollRootRef?: Ref<HTMLDivElement | null>;
  onChange: (prayer: Prayer, options?: { coalesceKey?: string }) => void;
  onKeepLocal: () => void;
  onReloadFromDisk: () => void;
  onVisibleVariantsChange: (cols: ActiveVariant[]) => void;
  onSave: () => void;
  onSettings: () => void;
  onExport: () => void;
  onRenameKind: (from: string, to: string) => void;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else ref.current = value;
}

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
  prayerPath,
  libraryRoot,
  visibleVariants,
  styles,
  styleEditing,
  busy,
  dirty,
  errors,
  diskConflict,
  editorRef,
  scrollRootRef,
  onChange,
  onKeepLocal,
  onReloadFromDisk,
  onVisibleVariantsChange,
  onSave,
  onSettings,
  onExport,
  onRenameKind,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const localEditorRef = useRef<InlineEditorHandle | null>(null);
  const setEditorRef = useCallback(
    (handle: InlineEditorHandle | null) => {
      localEditorRef.current = handle;
      assignRef(editorRef, handle);
    },
    [editorRef],
  );
  usePrayerScroll(libraryRoot, prayerPath, bodyRef);
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

  const located = useMemo(
    () => locateValidationErrors(prayer, errors),
    [prayer, errors],
  );
  const issues = useMemo(() => {
    const byBlock = new Map<string, BlockIssues>();
    for (const { error, blockId, variant } of located) {
      if (!blockId) continue;
      const entry = byBlock.get(blockId) ?? {
        messages: [],
        variantKeys: new Set<string>(),
      };
      if (!entry.messages.includes(error.message)) {
        entry.messages.push(error.message);
      }
      if (variant) entry.variantKeys.add(variantKey(variant));
      byBlock.set(blockId, entry);
    }
    return byBlock;
  }, [located]);

  const jumpToIssue = (blockId: string) => {
    localEditorRef.current?.revealBlock(blockId, {
      scroll: "smooth-center",
      focusCol: null,
      flash: true,
    });
  };

  const findReplace = useFindReplace({
    prayer,
    prayerPath,
    visibleVariants,
    onChange,
    scrollRootRef: bodyRef,
  });

  return (
    <div className="workspace">
      <div
        className="workspace-header"
        data-find-open={findReplace.state.open ? "true" : undefined}
      >
        <div className="workspace-header-top">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <h1 className="workspace-title">{headerTitle}</h1>
            {dirty ? (
              <Badge size="sm" color="accent" variant="light">
                Unsaved
              </Badge>
            ) : null}
            {errors.length > 0 ? (
              <Popover width={340} position="bottom-start" withArrow shadow="md">
                <Popover.Target>
                  <Badge
                    component="button"
                    size="sm"
                    color="accent"
                    variant="filled"
                    className="workspace-issues-badge"
                    leftSection={<IconAlertTriangle size={11} stroke={2.2} />}
                    aria-label={`${errors.length} validation problem${errors.length === 1 ? "" : "s"}`}
                  >
                    {errors.length} {errors.length === 1 ? "issue" : "issues"}
                  </Badge>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap={6}>
                    <Text size="xs" c="dimmed">
                      Fix these before saving.
                    </Text>
                    {located.map(({ error, blockId }, i) => (
                      <UnstyledButton
                        key={`${error.path}-${i}`}
                        className="workspace-issue-row"
                        disabled={!blockId}
                        onClick={() => {
                          if (blockId) jumpToIssue(blockId);
                        }}
                      >
                        <Text size="sm">{error.message}</Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {error.path}
                        </Text>
                      </UnstyledButton>
                    ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            ) : null}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip
              label={`Find (${shortcutLabel("Mod+F")})`}
              withArrow
              openDelay={300}
            >
              <ActionIcon
                size="sm"
                variant={findReplace.state.open ? "light" : "subtle"}
                color={findReplace.state.open ? "accent" : "gray"}
                aria-label="Find"
                aria-pressed={findReplace.state.open}
                onClick={() => findReplace.toggleFind()}
              >
                <IconSearch size={16} />
              </ActionIcon>
            </Tooltip>
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
            <Button
              size="xs"
              color="accent"
              loading={busy}
              onClick={onSave}
              disabled={!dirty}
            >
              Save
            </Button>
          </Group>
        </div>

        {diskConflict ? (
          <Alert
            className="workspace-disk-conflict"
            color="accent"
            variant="light"
            p="xs"
            icon={<IconAlertTriangle size={16} />}
            title={
              diskConflict === "deleted" ? "Deleted on disk" : "Changed on disk"
            }
          >
            <Group justify="space-between" gap="xs" wrap="wrap">
              <Text size="sm">
                {diskConflict === "deleted"
                  ? "The file was deleted outside the app. Saving recreates it."
                  : "The file was changed outside the app. Saving overwrites those changes."}
              </Text>
              <Group gap={6} wrap="nowrap">
                <Button size="compact-xs" variant="default" onClick={onKeepLocal}>
                  Keep my version
                </Button>
                <Button
                  size="compact-xs"
                  color="accent"
                  variant="light"
                  onClick={onReloadFromDisk}
                >
                  {diskConflict === "deleted" ? "Close prayer" : "Load from disk"}
                </Button>
              </Group>
            </Group>
          </Alert>
        ) : null}

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

        {findReplace.state.open ? (
          <FindReplacePanel
            state={findReplace.state}
            matchCount={findReplace.matches.length}
            currentIndex={findReplace.activeIndex}
            findInputRef={findReplace.findInputRef}
            replaceInputRef={findReplace.replaceInputRef}
            onQueryChange={(query) =>
              findReplace.patch({ query, currentIndex: 0 })
            }
            onReplaceWithChange={(replaceWith) =>
              findReplace.patch({ replaceWith })
            }
            onToggleMatchCase={() =>
              findReplace.patch({
                matchCase: !findReplace.state.matchCase,
                currentIndex: 0,
              })
            }
            onToggleWholeWord={() =>
              findReplace.patch({
                wholeWord: !findReplace.state.wholeWord,
                currentIndex: 0,
              })
            }
            onToggleReplaceExpanded={() =>
              findReplace.patch({
                replaceExpanded: !findReplace.state.replaceExpanded,
              })
            }
            onClose={findReplace.closeFind}
            onNext={findReplace.goNext}
            onPrev={findReplace.goPrev}
            onReplaceCurrent={findReplace.replaceCurrent}
            onReplaceAll={findReplace.requestReplaceAll}
          />
        ) : null}
      </div>

      <div
        className="workspace-body"
        ref={(el) => {
          bodyRef.current = el;
          assignRef(scrollRootRef, el);
        }}
      >
        <div className="workspace-body-inner" data-split={split ? "true" : undefined}>
          <InlineEditor
            ref={setEditorRef}
            prayer={prayer}
            visibleVariants={visibleVariants}
            styles={styles}
            styleEditing={styleEditing}
            issues={issues}
            onChange={onChange}
            onRenameKind={onRenameKind}
          />
        </div>
      </div>

      <ConfirmDialog
        opened={findReplace.replaceAllOpen}
        onClose={findReplace.cancelReplaceAll}
        onConfirm={findReplace.confirmReplaceAll}
        title="Replace all?"
        message={`Replace ${findReplace.replaceAllSummary.count} occurrence${
          findReplace.replaceAllSummary.count === 1 ? "" : "s"
        } in ${findReplace.replaceAllSummary.blockCount} block${
          findReplace.replaceAllSummary.blockCount === 1 ? "" : "s"
        }?`}
        confirmLabel="Replace all"
      />
    </div>
  );
}
