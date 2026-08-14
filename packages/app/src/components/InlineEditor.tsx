import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ActionIcon, Group, Menu, Stack } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconNote,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  isRunArray,
  plainText,
  toggleNoteRange,
  type InlineContent,
  type KindStyle,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { styleColorToCss } from "../colors";
import { KindSelect, KindTrigger } from "./KindSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { sameVariant, variantKey, type ActiveVariant } from "../variant";
import {
  getElementOffsets,
  getSelectionOffsets,
  mapOffsetToLine,
  renderEditable,
  selectionOverlapsNote,
  serializeEditable,
} from "../inlineDom";
import {
  addBlock as addBlockToPrayer,
  applyCommittedContent,
  editorCommitUnchanged,
  createBlockId,
  deleteKindWithStyles,
  fillPercent,
  getTranslation,
  insertBlockAfter as insertBlockAfterInPrayer,
  isBlockEmptyAcrossVariants,
  isTranslationFilled,
  kindOptions,
  moveBlock as moveBlockInPrayer,
  removeBlock,
  setBlockKind,
  translationEditorContent,
  usesLines,
} from "../prayerEdit";

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
  onChange: (prayer: Prayer) => void;
  onRenameKind: (from: string, to: string) => void;
};

export type BlockRevealScroll = "smooth-center" | "instant-start";

export type BlockRevealOptions = {
  scroll: BlockRevealScroll;
  /** When set, focus the editable in this column and place the caret at the end. */
  focusCol: ActiveVariant | null;
  flash: boolean;
};

export type InlineEditorHandle = {
  revealBlock: (blockId: string, options: BlockRevealOptions) => void;
};

const JUMP_FLASH_MS = 900;

function styleToCss(style: KindStyle): CSSProperties {
  const color = styleColorToCss(style.color);
  return {
    fontSize: style.fontSize,
    color,
    fontWeight: style.fontWeight as CSSProperties["fontWeight"],
    fontStyle: style.fontStyle as CSSProperties["fontStyle"],
  };
}

function isDomEmpty(el: HTMLElement): boolean {
  // Chrome often reports "\n" for an empty contenteditable.
  return (
    el.innerText.replace(/\u00a0/g, " ").replace(/\n/g, "").trim().length === 0
  );
}

function placeCaretAtEnd(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Place caret from a click; fall back to end when the hit misses text nodes. */
function placeCaretFromPoint(
  el: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  const sel = window.getSelection();
  if (!sel) return;

  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range && el.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos && el.contains(pos.offsetNode)) {
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }

  placeCaretAtEnd(el);
}

function selectionInside(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  return Boolean(node && el.contains(node));
}

function contentKey(content: InlineContent | InlineContent[]): string {
  return JSON.stringify(content);
}

function editorKey(blockId: string, col: ActiveVariant): string {
  return `${blockId}::${variantKey(col)}`;
}

/** Distance from text/selection top to toolbar top — same for add & remove. */
const NOTE_TOOLBAR_OFFSET_PX = 36;

function noteToolbarPos(rect: DOMRect): { top: number; left: number } {
  return {
    top: rect.top - NOTE_TOOLBAR_OFFSET_PX,
    left: rect.left + rect.width / 2,
  };
}

const EditableBlock = memo(function EditableBlock({
  content,
  lineMode,
  placeholder,
  style,
  noteColor,
  editorKey: key,
  blockId,
  initialCap = false,
  onCommit,
  onFocusChange,
  onInsertBelow,
  onDeleteAtStart,
  liveCommit = false,
}: {
  content: InlineContent | InlineContent[];
  lineMode: boolean;
  placeholder: string;
  style: CSSProperties;
  noteColor: string;
  editorKey: string;
  blockId: string;
  initialCap?: boolean;
  /** Commit on every input (outline kinds need live Content labels). */
  liveCommit?: boolean;
  onCommit: (content: InlineContent | InlineContent[] | null) => void;
  onFocusChange?: (blockId: string, focused: boolean) => void;
  onInsertBelow?: (content: InlineContent | InlineContent[] | null) => void;
  /** Backspace in an empty cell — parent decides confirm vs immediate delete. */
  onDeleteAtStart?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const skipBlurCommitRef = useRef(false);
  const dirtyRef = useRef(false);
  const skipSyncOnBlurRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [domEmpty, setDomEmpty] = useState(() => {
    if (lineMode) {
      const lines = content as InlineContent[];
      return lines.every((l) => plainText(l).trim().length === 0);
    }
    return plainText(content as InlineContent).trim().length === 0;
  });
  const [toolbar, setToolbar] = useState<{
    top: number;
    left: number;
    start: number;
    end: number;
    active: boolean;
    source: "selection" | "hover";
  } | null>(null);
  const toolbarRef = useRef(toolbar);
  toolbarRef.current = toolbar;
  const hoverHideTimerRef = useRef<number | null>(null);

  const cancelHoverHide = () => {
    if (hoverHideTimerRef.current !== null) {
      window.clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
  };

  const scheduleHoverHide = () => {
    cancelHoverHide();
    hoverHideTimerRef.current = window.setTimeout(() => {
      if (toolbarRef.current?.source === "hover") {
        setToolbar(null);
      }
      hoverHideTimerRef.current = null;
    }, 280);
  };

  useEffect(() => {
    return () => cancelHoverHide();
  }, []);

  const syncFromProps = () => {
    const el = ref.current;
    if (!el) return;
    dirtyRef.current = false;
    renderEditable(el, content, lineMode);
    setDomEmpty(isDomEmpty(el));
  };

  useEffect(() => {
    if (!ref.current || focused) return;
    if (skipSyncOnBlurRef.current) {
      skipSyncOnBlurRef.current = false;
      return;
    }
    syncFromProps();
  }, [contentKey(content), lineMode, focused]);

  useLayoutEffect(() => {
    syncFromProps();
  }, []);

  const readContent = (): InlineContent | InlineContent[] | null => {
    const el = ref.current;
    if (!el) return null;
    return serializeEditable(el, lineMode);
  };

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const updateToolbar = () => {
    const el = ref.current;
    if (!el || document.activeElement !== el) {
      setToolbar(null);
      return;
    }
    const offsets = getSelectionOffsets(el);
    if (!offsets || offsets.start === offsets.end) {
      // Keep hover toolbar if present; otherwise clear.
      if (toolbarRef.current?.source !== "hover") setToolbar(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      if (toolbarRef.current?.source !== "hover") setToolbar(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      if (toolbarRef.current?.source !== "hover") setToolbar(null);
      return;
    }
    setToolbar({
      ...noteToolbarPos(rect),
      start: offsets.start,
      end: offsets.end,
      active: selectionOverlapsNote(el),
      source: "selection",
    });
  };

  const showHoverToolbar = (noteEl: HTMLElement) => {
    const el = ref.current;
    if (!el) return;
    const offsets = getSelectionOffsets(el);
    // A real text selection for marking wins over hover.
    if (
      offsets &&
      offsets.start !== offsets.end &&
      !selectionOverlapsNote(el)
    ) {
      return;
    }
    const noteOffsets = getElementOffsets(el, noteEl);
    // Same geometry as a text selection over this note (not the element box).
    const range = document.createRange();
    range.selectNodeContents(noteEl);
    const rect = range.getBoundingClientRect();
    cancelHoverHide();
    setToolbar({
      ...noteToolbarPos(rect),
      start: noteOffsets.start,
      end: noteOffsets.end,
      active: true,
      source: "hover",
    });
  };

  const onNoteHoverMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const noteEl = (e.target as HTMLElement | null)?.closest?.(
      ".inline-note",
    ) as HTMLElement | null;
    if (!noteEl || !el.contains(noteEl)) return;
    const offsets = getSelectionOffsets(el);
    if (offsets && offsets.start !== offsets.end && !selectionOverlapsNote(el)) {
      return;
    }
    showHoverToolbar(noteEl);
  };

  const applyToggleNote = () => {
    const el = ref.current;
    const saved = toolbarRef.current;
    if (!el || !saved || saved.start === saved.end) return;

    markDirty();
    if (lineMode) {
      const lines =
        (serializeEditable(el, true) as InlineContent[] | null) ?? [];
      const startMap = mapOffsetToLine(lines, saved.start);
      const endMap = mapOffsetToLine(lines, saved.end);
      if (startMap.lineIndex !== endMap.lineIndex) {
        setToolbar(null);
        return;
      }
      const lineIndex = startMap.lineIndex;
      const line = lines[lineIndex] ?? "";
      const nextLine = toggleNoteRange(line, startMap.local, endMap.local);
      const nextLines = [...lines];
      nextLines[lineIndex] = nextLine;
      renderEditable(el, nextLines, true);
      setDomEmpty(isDomEmpty(el));
      onCommit(nextLines.length === 0 ? null : nextLines);
    } else {
      const current = serializeEditable(el, false);
      if (current === null) return;
      // Text mode yields InlineContent (string | TextRun[]), never a line list.
      const inline = (
        Array.isArray(current) && !isRunArray(current)
          ? (current as InlineContent[]).map((l) => plainText(l)).join("\n")
          : current
      ) as InlineContent;
      const next = toggleNoteRange(inline, saved.start, saved.end);
      renderEditable(el, next, false);
      setDomEmpty(isDomEmpty(el));
      onCommit(plainText(next).length === 0 ? null : next);
    }
    dirtyRef.current = false;
    setToolbar(null);
    el.focus();
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.(".inline-note-toolbar")) {
      return;
    }
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    setFocused(false);
    onFocusChange?.(blockId, false);
    setToolbar(null);

    if (!dirtyRef.current) {
      skipSyncOnBlurRef.current = true;
      setDomEmpty(isDomEmpty(e.currentTarget));
      return;
    }

    dirtyRef.current = false;
    setDomEmpty(isDomEmpty(e.currentTarget));
    const serialized = serializeEditable(e.currentTarget, lineMode);
    if (editorCommitUnchanged(content, serialized, lineMode)) {
      return;
    }
    onCommit(serialized);
  };

  const focusAtPoint = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    placeCaretFromPoint(el, clientX, clientY);
    setFocused(true);
    onFocusChange?.(blockId, true);
  };

  return (
    <>
      <div
        ref={ref}
        className="inline-content"
        contentEditable
        suppressContentEditableWarning
        data-empty={domEmpty ? "true" : undefined}
        data-editor={key}
        data-initial-cap={initialCap ? "true" : undefined}
        role="textbox"
        aria-multiline="true"
        style={{
          ...style,
          caretColor: typeof style.color === "string" ? style.color : undefined,
          ["--inline-note-color" as string]: noteColor,
        }}
        onMouseDown={(e) => {
          const el = ref.current;
          if (!el) return;
          if (isDomEmpty(el)) {
            e.preventDefault();
            focusAtPoint(e.clientX, e.clientY);
          }
        }}
        onClick={(e) => {
          const el = ref.current;
          if (!el || document.activeElement !== el) return;
          if (!selectionInside(el)) {
            placeCaretFromPoint(el, e.clientX, e.clientY);
          }
          requestAnimationFrame(updateToolbar);
        }}
        onMouseMove={onNoteHoverMove}
        onMouseLeave={(e) => {
          const related = e.relatedTarget as HTMLElement | null;
          if (related?.closest?.(".inline-note-toolbar")) {
            cancelHoverHide();
            return;
          }
          if (related?.closest?.(".inline-note")) return;
          if (toolbarRef.current?.source === "hover") {
            scheduleHoverHide();
          }
        }}
        onFocus={() => {
          setFocused(true);
          onFocusChange?.(blockId, true);
          requestAnimationFrame(() => {
            const el = ref.current;
            if (!el || !isDomEmpty(el)) return;
            if (!selectionInside(el)) placeCaretAtEnd(el);
          });
        }}
        onKeyUp={updateToolbar}
        onSelect={updateToolbar}
        onKeyDown={(e) => {
          if (
            (e.key === "m" || e.key === "M") &&
            (e.metaKey || e.ctrlKey) &&
            e.shiftKey
          ) {
            e.preventDefault();
            applyToggleNote();
            return;
          }

          if (e.key === "Backspace") {
            if (e.nativeEvent.isComposing) return;
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (!onDeleteAtStart) return;
            const el = ref.current;
            if (!el || !isDomEmpty(el)) return;
            e.preventDefault();
            skipBlurCommitRef.current = true;
            onDeleteAtStart();
            return;
          }

          if (e.key !== "Enter") return;
          if (e.nativeEvent.isComposing) return;

          if (e.shiftKey) {
            e.preventDefault();
            markDirty();
            document.execCommand("insertText", false, "\n");
            if (ref.current) setDomEmpty(isDomEmpty(ref.current));
            return;
          }

          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if (!onInsertBelow) return;

          e.preventDefault();
          skipBlurCommitRef.current = true;
          onInsertBelow(readContent());
        }}
        onInput={() => {
          markDirty();
          if (ref.current) setDomEmpty(isDomEmpty(ref.current));
          updateToolbar();
          if (!liveCommit) return;
          const serialized = readContent();
          if (editorCommitUnchanged(content, serialized, lineMode)) return;
          onCommit(serialized);
          dirtyRef.current = false;
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          markDirty();
          const inserted = document.execCommand("insertText", false, text);
          if (!inserted) {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          if (ref.current) setDomEmpty(isDomEmpty(ref.current));
        }}
        onBlur={handleBlur}
        data-placeholder={placeholder}
      />

      {toolbar ? (
        <div
          className="inline-note-toolbar"
          data-source={toolbar.source}
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            skipBlurCommitRef.current = true;
            cancelHoverHide();
          }}
          onMouseEnter={cancelHoverHide}
          onMouseLeave={() => {
            if (toolbarRef.current?.source === "hover") {
              scheduleHoverHide();
            }
          }}
        >
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            data-active={toolbar.active ? "true" : undefined}
            title={toolbar.active ? "Remove inline note" : "Mark as inline note"}
            aria-label={
              toolbar.active ? "Remove inline note" : "Mark as inline note"
            }
            aria-pressed={toolbar.active}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              skipBlurCommitRef.current = true;
              cancelHoverHide();
              // Apply on mousedown so blur cannot clear toolbar state first.
              applyToggleNote();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <IconNote size={14} stroke={1.75} />
          </ActionIcon>
        </div>
      ) : null}
    </>
  );
});

export const InlineEditor = forwardRef<InlineEditorHandle, Props>(
  function InlineEditor(
    {
      prayer,
      visibleVariants,
      styles,
      styleEditing,
      onChange,
      onRenameKind,
    },
    ref,
  ) {
  const [kindUiBlockId, setKindUiBlockId] = useState<string | null>(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(
    null,
  );
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  const [lastAddedKind, setLastAddedKind] = useState("verse");
  const layoutRef = useRef<HTMLDivElement>(null);
  const focusedIdRef = useRef<string | null>(null);
  const kindUiBlockIdRef = useRef<string | null>(null);
  kindUiBlockIdRef.current = kindUiBlockId;

  const kinds = useMemo(() => kindOptions(prayer), [prayer]);
  const split = visibleVariants.length > 1;
  const kindsUsedKey = prayer.structure.map((b) => b.kind).join("\0");

  const cssByKind = useMemo(() => {
    const out: Record<string, CSSProperties> = {};
    for (const kind of new Set(kindsUsedKey.split("\0").filter(Boolean))) {
      out[kind] = styleToCss(styles[kind] ?? FALLBACK_KIND_STYLE);
    }
    return out;
  }, [kindsUsedKey, styles]);

  const noteColor = useMemo(
    () =>
      styleColorToCss(
        styles.annotation?.color ?? FALLBACK_KIND_STYLE.color,
      ),
    [styles.annotation?.color],
  );

  const ctxRef = useRef({
    prayer,
    onChange,
    styleEditing,
    onRenameKind,
    visibleVariants,
  });
  ctxRef.current = {
    prayer,
    onChange,
    styleEditing,
    onRenameKind,
    visibleVariants,
  };

  const handlersRef = useRef({
    commit: new Map<string, (c: InlineContent | InlineContent[] | null) => void>(),
    insert: new Map<string, (c: InlineContent | InlineContent[] | null) => void>(),
    delete: new Map<string, () => void>(),
  });

  const handleFocusChange = useCallback((blockId: string, focused: boolean) => {
    if (focused) {
      focusedIdRef.current = blockId;
      return;
    }
    if (
      focusedIdRef.current === blockId &&
      kindUiBlockIdRef.current !== blockId
    ) {
      focusedIdRef.current = null;
    }
  }, []);

  const handleKindIdle = useCallback(() => {
    setKindUiBlockId(null);
  }, []);

  const revealBlock = useCallback(
    (blockId: string, options: BlockRevealOptions) => {
      const root = layoutRef.current;
      if (!root) return;

      const blockEl = root.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(blockId)}"]`,
      );
      if (!blockEl) return;

      if (options.flash) {
        setJumpTargetId(blockId);
        window.setTimeout(() => {
          setJumpTargetId((id) => (id === blockId ? null : id));
        }, JUMP_FLASH_MS);
      }

      if (options.scroll === "smooth-center") {
        const focusTarget = options.focusCol
          ? root.querySelector<HTMLElement>(
              `[data-editor="${CSS.escape(editorKey(blockId, options.focusCol))}"]`,
            )
          : null;
        (focusTarget ?? blockEl).scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } else {
        const scroller = blockEl.closest(".workspace-body") as HTMLElement | null;
        if (scroller) {
          const sticky = scroller.querySelector<HTMLElement>(".split-col-labels");
          const offset = sticky?.offsetHeight ?? 0;
          const blockRect = blockEl.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          const delta = blockRect.top - scrollerRect.top - offset;
          scroller.scrollTo({
            top: scroller.scrollTop + delta,
            behavior: "auto",
          });
        } else {
          blockEl.scrollIntoView({ behavior: "auto", block: "start" });
        }
      }

      if (options.focusCol) {
        const key = editorKey(blockId, options.focusCol);
        const editable = root.querySelector<HTMLElement>(
          `[data-editor="${CSS.escape(key)}"]`,
        );
        if (!editable) return;
        focusedIdRef.current = blockId;
        editable.focus();
        placeCaretAtEnd(editable);
      }
    },
    [],
  );

  useImperativeHandle(ref, () => ({ revealBlock }), [revealBlock]);

  const focusEditor = useCallback(
    (blockId: string, col: ActiveVariant) => {
      revealBlock(blockId, {
        scroll: "smooth-center",
        focusCol: col,
        flash: true,
      });
    },
    [revealBlock],
  );

  const requestDeleteBlock = useCallback(
    (
      index: number,
      options?: { treatAsEmpty?: ActiveVariant; focusCol?: ActiveVariant },
    ) => {
      const { prayer: p, visibleVariants: cols, onChange: change } =
        ctxRef.current;
      const block = p.structure[index];
      if (!block) return;

      const empty = isBlockEmptyAcrossVariants(p, block.id, {
        treatAsEmpty: options?.treatAsEmpty,
      });

      if (empty && p.structure.length > 1) {
        const focusCol =
          options?.focusCol ?? options?.treatAsEmpty ?? cols[0];
        const prevId = p.structure[index - 1]?.id;
        const nextId = p.structure[index + 1]?.id;
        change(removeBlock(p, index));
        const focusId = prevId ?? nextId;
        if (focusId && focusCol) {
          window.setTimeout(() => focusEditor(focusId, focusCol), 0);
        }
        return;
      }

      // Backspace on the sole (empty) block: nothing to remove.
      if (options?.treatAsEmpty !== undefined) return;

      setPendingDeleteIndex(index);
    },
    [focusEditor],
  );

  const focusEditorRef = useRef(focusEditor);
  focusEditorRef.current = focusEditor;
  const requestDeleteBlockRef = useRef(requestDeleteBlock);
  requestDeleteBlockRef.current = requestDeleteBlock;

  const getCommitHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.commit.get(key);
    if (!fn) {
      fn = (next) => {
        const { prayer: p, onChange: change } = ctxRef.current;
        change(applyCommittedContent(p, blockId, col, next));
      };
      handlersRef.current.commit.set(key, fn);
    }
    return fn;
  };

  const getInsertHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.insert.get(key);
    if (!fn) {
      fn = (next) => {
        const { prayer: p, onChange: change } = ctxRef.current;
        const index = p.structure.findIndex((b) => b.id === blockId);
        if (index < 0) return;
        const current = p.structure[index];
        if (!current) return;
        const id = createBlockId(p.structure.length);
        const updated = insertBlockAfterInPrayer(p, index, col, next, id);
        setLastAddedKind(current.kind);
        change(updated);
        window.setTimeout(() => focusEditorRef.current(id, col), 0);
      };
      handlersRef.current.insert.set(key, fn);
    }
    return fn;
  };

  const getDeleteHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.delete.get(key);
    if (!fn) {
      fn = () => {
        const { prayer: p } = ctxRef.current;
        const index = p.structure.findIndex((b) => b.id === blockId);
        if (index < 0) return;
        requestDeleteBlockRef.current(index, {
          treatAsEmpty: col,
          focusCol: col,
        });
      };
      handlersRef.current.delete.set(key, fn);
    }
    return fn;
  };

  // Prune stale cell handlers when structure / columns change.
  useEffect(() => {
    const live = new Set<string>();
    for (const block of prayer.structure) {
      for (const col of visibleVariants) {
        live.add(editorKey(block.id, col));
      }
    }
    for (const map of [
      handlersRef.current.commit,
      handlersRef.current.insert,
      handlersRef.current.delete,
    ]) {
      for (const key of map.keys()) {
        if (!live.has(key)) map.delete(key);
      }
    }
  }, [prayer.structure, visibleVariants]);

  const jumpToNextEmpty = (col: ActiveVariant) => {
    const emptyIndexes = prayer.structure
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => !isTranslationFilled(prayer, block.id, col));
    if (emptyIndexes.length === 0) return;

    const currentIdx = focusedIdRef.current
      ? prayer.structure.findIndex((b) => b.id === focusedIdRef.current)
      : -1;
    const next =
      emptyIndexes.find(({ index }) => index > currentIdx) ?? emptyIndexes[0]!;
    focusEditor(next.block.id, col);
  };

  const addBlock = (kind: string = lastAddedKind) => {
    const id = createBlockId(prayer.structure.length);
    const col = visibleVariants[0];
    setLastAddedKind(kind);
    onChange(addBlockToPrayer(prayer, kind, id));
    if (col) {
      window.setTimeout(() => focusEditor(id, col), 0);
    }
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    onChange(moveBlockInPrayer(prayer, index, dir));
  };

  return (
    <Stack gap={4}>
      <div
        ref={layoutRef}
        className="split-layout"
        style={
          {
            "--split-count": visibleVariants.length,
          } as CSSProperties
        }
        data-split={split ? "true" : undefined}
      >
        {split ? (
          <div className="split-rules" aria-hidden="true">
            {visibleVariants.map((col) => (
              <span key={variantKey(col)} />
            ))}
          </div>
        ) : null}

        {split ? (
          <div className="split-col-labels">
            <div className="split-row">
              {visibleVariants.map((col) => {
                const { filled, total, percent } = fillPercent(prayer, col);
                const complete = total > 0 && filled === total;
                return (
                  <div key={variantKey(col)} className="split-cell split-col-label">
                    <span className="split-col-label-lang">{col.lang}</span>
                    <span className="split-col-label-variant">{col.variant}</span>
                    <button
                      type="button"
                      className="split-col-fill"
                      data-complete={complete ? "true" : undefined}
                      disabled={complete || total === 0}
                      title={
                        complete
                          ? "All blocks filled"
                          : `${filled} of ${total} blocks filled — click to jump to next empty`
                      }
                      aria-label={
                        complete
                          ? `${percent}% filled`
                          : `${percent}% filled. Jump to next empty block`
                      }
                      onClick={() => jumpToNextEmpty(col)}
                    >
                      {percent}%
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {prayer.structure.map((block, index) => {
          const lineMode = usesLines(block.kind);
          const styleCss =
            cssByKind[block.kind] ?? styleToCss(FALLBACK_KIND_STYLE);

          return (
            <div
              key={block.id}
              className="inline-block"
              data-block-id={block.id}
              data-jump-target={jumpTargetId === block.id ? "true" : undefined}
              data-menu-open={kindUiBlockId === block.id ? "true" : undefined}
              data-split={split ? "true" : undefined}
              onMouseDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".inline-block-chrome")) return;
                if (target.closest(".inline-content")) return;
                if (target.closest(".inline-note-toolbar")) return;

                const row = e.currentTarget.querySelector(".split-row");
                if (!row) return;
                const cells = [
                  ...row.querySelectorAll<HTMLElement>(".split-cell"),
                ];
                const cell =
                  cells.find((c) => {
                    const r = c.getBoundingClientRect();
                    return e.clientX >= r.left && e.clientX <= r.right;
                  }) ?? cells[0];
                const editable =
                  cell?.querySelector<HTMLElement>(".inline-content");
                if (!editable) return;

                e.preventDefault();
                editable.focus();
                placeCaretFromPoint(editable, e.clientX, e.clientY);
                focusedIdRef.current = block.id;
              }}
            >
              <div className="inline-block-chrome">
                {kindUiBlockId === block.id ? (
                  <KindSelect
                    key={block.id}
                    compact
                    defaultOpen
                    value={block.kind}
                    options={kinds}
                    styleEditing={styleEditing}
                    onIdle={handleKindIdle}
                    onChange={(kind) => {
                      onChange(setBlockKind(prayer, index, kind));
                    }}
                    onRename={(from, to) => {
                      onRenameKind(from, to);
                    }}
                    onDelete={(kind) => {
                      const next = deleteKindWithStyles(
                        prayer,
                        styleEditing.appStyles,
                        styleEditing.libraryStyles,
                        kind,
                      );
                      onChange(next.prayer);
                      styleEditing.onChangeApp(next.appStyles);
                      styleEditing.onChangeLibrary(next.libraryStyles);
                    }}
                  />
                ) : (
                  <KindTrigger
                    compact
                    value={block.kind}
                    onClick={() => setKindUiBlockId(block.id)}
                  />
                )}
                <Group gap={2}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => moveBlock(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <IconArrowUp size={14} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => moveBlock(index, 1)}
                    disabled={index === prayer.structure.length - 1}
                    aria-label="Move down"
                  >
                    <IconArrowDown size={14} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="accent"
                    onClick={() => requestDeleteBlock(index)}
                    aria-label="Delete block"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </div>

              <div className="split-row">
                {visibleVariants.map((col) => {
                  const tr = getTranslation(prayer, block.id, col);
                  const content = translationEditorContent(block.kind, tr);

                  return (
                    <div
                      key={variantKey(col)}
                      className="split-cell"
                      data-lang={col.lang}
                    >
                      <EditableBlock
                        content={content}
                        lineMode={lineMode}
                        editorKey={editorKey(block.id, col)}
                        blockId={block.id}
                        placeholder="Prayer text"
                        style={styleCss}
                        noteColor={noteColor}
                        initialCap={
                          (styles[block.kind] ?? FALLBACK_KIND_STYLE)
                            .initialCap === "true"
                        }
                        liveCommit={
                          (block.kind === "heading" ||
                            block.kind === "subheading") &&
                          Boolean(
                            visibleVariants[0] &&
                              sameVariant(col, visibleVariants[0]),
                          )
                        }
                        onFocusChange={handleFocusChange}
                        onCommit={getCommitHandler(block.id, col)}
                        onInsertBelow={getInsertHandler(block.id, col)}
                        onDeleteAtStart={getDeleteHandler(block.id, col)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="add-block">
        <button
          type="button"
          className="add-block-main"
          onClick={() => addBlock()}
        >
          <IconPlus size={14} stroke={2.2} />
          <span>Add {lastAddedKind}</span>
        </button>
        <Menu shadow="md" width={180} position="bottom-start" withinPortal>
          <Menu.Target>
            <button
              type="button"
              className="add-block-menu"
              aria-label="Choose block kind"
            >
              <IconChevronDown size={14} stroke={2.2} />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Block kind</Menu.Label>
            {kinds.map((kind) => (
              <Menu.Item
                key={kind}
                onClick={() => addBlock(kind)}
                disabled={kind === lastAddedKind}
              >
                {kind}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </div>

      <ConfirmDialog
        opened={pendingDeleteIndex !== null}
        onClose={() => setPendingDeleteIndex(null)}
        title="Delete block?"
        message="This removes the block and its translations from the prayer. You can undo by not saving."
        onConfirm={() => {
          if (pendingDeleteIndex === null) return;
          onChange(removeBlock(prayer, pendingDeleteIndex));
          setPendingDeleteIndex(null);
        }}
      />
    </Stack>
  );
  },
);
