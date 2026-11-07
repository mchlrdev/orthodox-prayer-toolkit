import {
  createContext,
  forwardRef,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ActionIcon, Group, Menu, Stack, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconCircleOff,
  IconClipboard,
  IconCopy,
  IconCut,
  IconNote,
  IconPalette,
  IconPlus,
  IconRowInsertBottom,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  isRunArray,
  kindAllowsSpeaker,
  kindDisplayLabel,
  pickerKinds,
  plainText,
  resolveDir,
  setBlockSpeaker,
  resolveSpeakerLabel,
  speakerChipLabel,
  toggleNoteRange,
  type Block,
  type InlineContent,
  type KindDef,
  type KindStyle,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { styleColorToCss } from "../colors";
import {
  KindSelect,
  KindTrigger,
  kindContextItems,
  type KindGroupScope,
} from "./KindSelect";
import { kindFontSizeToEditor } from "../kindFontSize";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { getToolkitApi } from "../api";
import {
  FLUSH_EDITS_EVENT,
  flushPendingEdits,
  notifyUncommittedChange,
  SPEAKER_SHORTCUT,
  shortcutLabel,
} from "../appCommands";
import {
  rememberCtxPrayer,
  snapshotAfterFlush,
} from "../flushedEditorCtx";
import {
  armTransientSkipBlurCommit,
  editableBlurDecision,
} from "../editableBlur";
import {
  applyIdleCommitTrigger,
  cancelIdleCommitTimer,
  nativeEventIsComposing,
  type IdleCommitTimer,
  type IdleCommitTrigger,
} from "../idleCommit";
import {
  SpeakerChip,
  SpeakerMenu,
  SpeakerTrigger,
  speakerContextItems,
  speakerOptions,
} from "./SpeakerMenu";
import { sameVariant, variantKey, type ActiveVariant } from "../variant";
import { runEditorClipboardAction } from "../editorClipboard";
import {
  createRangeFromOffsets,
  getElementOffsets,
  getSelectionOffsets,
  mapOffsetToLine,
  renderEditable,
  restoreSelectionOffsets,
  selectionOverlapsNote,
  serializeEditable,
} from "../inlineDom";
import {
  addBlock as addBlockToPrayer,
  applyCommittedContent,
  editorCommitUnchanged,
  createBlockId,
  fillPercent,
  getTranslation,
  isBlockEmptyAcrossVariants,
  isTranslationFilled,
  mergeBlocks,
  moveBlock as moveBlockInPrayer,
  moveRemainderToNext,
  removeBlock,
  setBlockKind,
  splitBlock as splitBlockInPrayer,
  splitEditorContent,
  translationEditorContent,
  usesLines,
} from "../prayerEdit";

type StyleEditing = {
  resolved: StyleMap;
  libraryEnabled: boolean;
  /** Every kind in the library: a rename must not collide with any. */
  libraryKinds: string[];
  /** Patch one kind's library style (applied to the latest styles.json). */
  onPatchStyle: (kind: string, partial: Partial<KindStyle>) => void;
};

/** Validation problems of one block, for markers (from Core locateValidationErrors). */
export type BlockIssues = {
  messages: string[];
  /** variantKey()s of translation cells the problems point at. */
  variantKeys: Set<string>;
};

type Props = {
  prayer: Prayer;
  visibleVariants: ActiveVariant[];
  styles: StyleMap;
  styleEditing: StyleEditing;
  issues?: Map<string, BlockIssues>;
  /** `coalesceKey`: typing in one cell merges into one undo step. */
  onChange: (prayer: Prayer, options?: { coalesceKey?: string }) => void;
  onRenameKind: (from: string, to: string) => void;
  /** Delete a custom kind from this prayer (via the session; undoable). */
  onDeleteKind: (kind: string) => void;
  /** Allow / disallow speakers for a custom kind of this prayer (undoable). */
  onSetKindSpeaker: (kind: string, allowed: boolean) => void;
  /** "More speakers…" / "More kinds…": open Prayer settings on that pane. */
  onOpenSettings?: (pane: "speakers" | "kinds") => void;
  /** Replace the editor's own Prayer edits (see {@link EditorEdits}). */
  edits?: EditorEdits;
  /** Extra first cell of each block row (Import draft: its Source segments). */
  leadCell?: (blockId: string) => ReactNode;
  /** Full-width rows after a block (null = before the first block). */
  rowsAfter?: (blockId: string | null) => ReactNode;
  /** Blocks to mark (what one Chat pane answer changed or would change). */
  markedBlocks?: ReadonlySet<string>;
};

/** Which block's Speaker dropdown is open, and what it hangs from. */
type SpeakerUi = { blockId: string; anchor: "chip" | "chrome" };

/** Caret to restore after a keyboard-opened Speaker dropdown closes. */
type CaretRestore = { editor: string; start: number; end: number };

export type BlockRevealScroll = "smooth-center" | "instant-start" | "nearest";

export type BlockRevealCaret =
  | "start"
  | "end"
  | { x: number; line: "start" | "end" };

export type BlockRevealOptions = {
  scroll: BlockRevealScroll;
  /** When set, focus the editable in this column. */
  focusCol: ActiveVariant | null;
  flash: boolean;
  /** Caret placement when focusing. Default: end. */
  caret?: BlockRevealCaret;
};

/** What the parent did on Backspace at a cell's start / Delete at its end. */
export type JoinOutcome =
  | { kind: "removed" }
  | { kind: "merged"; content: InlineContent | InlineContent[]; caret: number }
  | null;

export type JoinDirection = "backward" | "forward";

/** Cell content at Enter, with the plain-text selection (may be Infinity = end). */
export type SplitPoint = {
  content: InlineContent | InlineContent[] | null;
  start: number;
  end: number;
};

/**
 * Edits the editor would otherwise make on the Prayer itself. Given, they
 * replace those edits (the Import draft turns them into Import operations);
 * adding blocks is then not offered.
 */
export type EditorEdits = {
  /** Typing in one cell (coalesced into one undo step by the owner). */
  commit: (
    blockId: string,
    col: ActiveVariant,
    content: InlineContent | InlineContent[] | null,
  ) => void;
  /** Enter: id of the new lower block, or null when refused. */
  split: (blockId: string, col: ActiveVariant, at: SplitPoint) => string | null;
  join: (
    blockId: string,
    col: ActiveVariant,
    direction: JoinDirection,
    current: InlineContent | InlineContent[] | null,
  ) => JoinOutcome;
  setKind: (blockId: string, kind: string) => void;
  setSpeaker: (blockId: string, speaker: string | null) => void;
  remove: (blockId: string) => void;
  move: (blockId: string, dir: -1 | 1) => void;
  /** The block's style group for the Kind picker's "whole group" side. */
  kindGroup?: (blockId: string) => KindGroupScope | null;
};

export type InlineEditorHandle = {
  revealBlock: (blockId: string, options: BlockRevealOptions) => void;
  /** Mod+Shift+P: Speaker dropdown on the block holding the caret. */
  openSpeakerMenu: () => boolean;
};

const JUMP_FLASH_MS = 900;

function styleToCss(style: KindStyle): CSSProperties {
  const color = styleColorToCss(style.color);
  const textAlign =
    style.textAlign === "center" || style.textAlign === "justify"
      ? style.textAlign
      : "start";
  return {
    fontSize: kindFontSizeToEditor(style.fontSize),
    color,
    fontWeight: style.fontWeight as CSSProperties["fontWeight"],
    fontStyle: style.fontStyle as CSSProperties["fontStyle"],
    textAlign,
  };
}

/**
 * No visible text in the cell. Reads textContent, not innerText: innerText
 * forces a synchronous layout, which made opening a long prayer lay out
 * once per cell. Cells hold only text nodes and inline spans (never hidden
 * content), so both give the same answer here.
 */
function isDomEmpty(el: HTMLElement): boolean {
  // Chrome often leaves "\n" (or a <br>) in an empty contenteditable.
  return (
    (el.textContent ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\n/g, "")
      .trim().length === 0
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

function placeCaretAtStart(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = createRangeFromOffsets(el, 0, 0);
  if (range) {
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  const fallback = document.createRange();
  fallback.selectNodeContents(el);
  fallback.collapse(true);
  sel.removeAllRanges();
  sel.addRange(fallback);
}

function textBesideCaret(
  el: HTMLElement,
  side: "before" | "after",
): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const caret = sel.getRangeAt(0);
  if (!el.contains(caret.startContainer) && caret.startContainer !== el) {
    return null;
  }
  const rest = document.createRange();
  rest.selectNodeContents(el);
  if (side === "before") rest.setEnd(caret.startContainer, caret.startOffset);
  else rest.setStart(caret.startContainer, caret.startOffset);
  return rest.toString();
}

/** Collapsed caret at the start (or end) of the cell's text. */
function caretAtEdge(el: HTMLElement, edge: "start" | "end"): boolean {
  if (isDomEmpty(el)) return true;
  const rest = textBesideCaret(el, edge === "start" ? "before" : "after");
  if (rest === null) return false;
  // Chrome may keep a trailing "\n" in the editable.
  return rest.replace(/\n/g, "").length === 0;
}

function rangeBox(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (const rect of rects) {
    if (rect.height > 0 || rect.width > 0) return rect;
  }
  const box = range.getBoundingClientRect();
  if (box.height === 0 && box.width === 0) return null;
  return box;
}

function contentLineBoxes(el: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.height > 0);
  // Inline spans (initial, notes) split one visual line into extra boxes.
  const lines: Array<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }> = [];
  for (const r of rects) {
    const current = lines[lines.length - 1];
    if (current && r.top < current.bottom && current.top < r.bottom) {
      current.left = Math.min(current.left, r.left);
      current.right = Math.max(current.right, r.right);
      current.top = Math.min(current.top, r.top);
      current.bottom = Math.max(current.bottom, r.bottom);
    } else {
      lines.push({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    }
  }
  return lines.map(
    (l) => new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top),
  );
}

/**
 * True when ArrowUp / ArrowDown should leave this Block.
 * Asks Chromium whether a line move stays at the cell's start / end, so a
 * collapsed caret sitting on the previous line's box is not treated as line 1.
 */
function caretOnBoundaryLine(
  el: HTMLElement,
  edge: "first" | "last",
): boolean {
  if (isDomEmpty(el)) return true;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const caret = sel.getRangeAt(0);
  if (!el.contains(caret.startContainer) && caret.startContainer !== el) {
    return false;
  }
  const saved = caret.cloneRange();
  try {
    sel.modify(
      "move",
      edge === "first" ? "backward" : "forward",
      "line",
    );
    return caretAtEdge(el, edge === "first" ? "start" : "end");
  } finally {
    sel.removeAllRanges();
    sel.addRange(saved);
  }
}

function caretClientX(el: HTMLElement): number {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const box = rangeBox(sel.getRangeAt(0));
    if (box) return box.left;
  }
  return el.getBoundingClientRect().left;
}

function placeCaretOnLine(
  el: HTMLElement,
  line: "start" | "end",
  clientX: number,
): void {
  if (isDomEmpty(el)) {
    placeCaretAtStart(el);
    return;
  }
  const lines = contentLineBoxes(el);
  const box = line === "start" ? lines[0] : lines[lines.length - 1];
  if (!box) {
    if (line === "start") placeCaretAtStart(el);
    else placeCaretAtEnd(el);
    return;
  }
  const x = Math.min(Math.max(clientX, box.left), box.right);
  if (line === "start" && x <= box.left + 2) {
    placeCaretAtStart(el);
    return;
  }
  if (line === "end" && x >= box.right - 2) {
    placeCaretAtEnd(el);
    return;
  }
  placeCaretFromPoint(el, x, box.top + box.height / 2);
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
  dir = "ltr",
  onCommit,
  onFocusChange,
  onInsertBelow,
  onSpillToNext,
  onArrowLeave,
  onJoin,
}: {
  content: InlineContent | InlineContent[];
  lineMode: boolean;
  placeholder: string;
  style: CSSProperties;
  noteColor: string;
  editorKey: string;
  blockId: string;
  initialCap?: boolean;
  dir?: "ltr" | "rtl";
  onCommit: (content: InlineContent | InlineContent[] | null) => void;
  onFocusChange?: (blockId: string, focused: boolean) => void;
  /** Enter. `split` is the cell before splitting; false = refused, keep the text. */
  onInsertBelow?: (
    before: InlineContent | InlineContent[] | null,
    after: InlineContent | InlineContent[] | null,
    split: SplitPoint,
  ) => boolean | void;
  /** Ctrl/Cmd+Enter: remainder goes into the next existing Block, same column. */
  onSpillToNext?: (
    before: InlineContent | InlineContent[] | null,
    after: InlineContent | InlineContent[] | null,
  ) => boolean;
  /** ArrowUp on the first visual line / ArrowDown on the last: neighbour Block. */
  onArrowLeave?: (direction: "up" | "down", clientX: number) => boolean;
  /** Backspace at the start / Delete at the end: merge with the neighbour Block. */
  onJoin?: (
    direction: JoinDirection,
    current: InlineContent | InlineContent[] | null,
  ) => JoinOutcome;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const skipBlurCommitRef = useRef(false);
  const dirtyRef = useRef(false);
  const idleTimerRef = useRef<IdleCommitTimer>({ id: null });
  const lineModeRef = useRef(lineMode);
  lineModeRef.current = lineMode;
  /** Typing the app has not taken yet; native undo applies while set. */
  const setUncommitted = (value: boolean) => {
    const changed = dirtyRef.current !== value;
    dirtyRef.current = value;
    const el = ref.current;
    if (el) {
      if (value) el.dataset.uncommitted = "true";
      else delete el.dataset.uncommitted;
    }
    if (changed) notifyUncommittedChange();
  };
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
    return () => {
      cancelHoverHide();
      cancelIdleCommitTimer(idleTimerRef.current);
    };
  }, []);

  const paint = (el: HTMLElement, next: InlineContent | InlineContent[]) => {
    renderEditable(el, next, lineMode, initialCap);
  };

  const syncFromProps = () => {
    const el = ref.current;
    if (!el) return;
    setUncommitted(false);
    paint(el, content);
    setDomEmpty(isDomEmpty(el));
  };

  // The layout effect below paints on mount; repainting the same content in
  // this effect's first run only doubled the cost of opening a prayer.
  const paintedOnMountRef = useRef(true);
  useEffect(() => {
    if (paintedOnMountRef.current) {
      paintedOnMountRef.current = false;
      return;
    }
    if (!ref.current || focused) return;
    if (skipSyncOnBlurRef.current) {
      skipSyncOnBlurRef.current = false;
      return;
    }
    syncFromProps();
  }, [contentKey(content), lineMode, initialCap, focused]);

  useLayoutEffect(() => {
    syncFromProps();
  }, []);

  const readContent = (): InlineContent | InlineContent[] | null => {
    const el = ref.current;
    if (!el) return null;
    return serializeEditable(el, lineMode);
  };

  // Save shortcuts commit pending typing without leaving the cell.
  const contentRef = useRef(content);
  contentRef.current = content;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const commitIfDirty = () => {
    if (!dirtyRef.current || !ref.current) return;
    const serialized = serializeEditable(ref.current, lineModeRef.current);
    setUncommitted(false);
    if (
      editorCommitUnchanged(
        contentRef.current,
        serialized,
        lineModeRef.current,
      )
    ) {
      return;
    }
    onCommitRef.current(serialized);
  };
  const commitIfDirtyRef = useRef(commitIfDirty);
  commitIfDirtyRef.current = commitIfDirty;

  const applyIdle = (trigger: IdleCommitTrigger) => {
    applyIdleCommitTrigger(idleTimerRef.current, trigger, () => {
      commitIfDirtyRef.current();
    });
  };

  useEffect(() => {
    const flush = () => {
      applyIdleCommitTrigger(idleTimerRef.current, { type: "flush" }, () => {
        commitIfDirtyRef.current();
      });
      commitIfDirtyRef.current();
    };
    window.addEventListener(FLUSH_EDITS_EVENT, flush);
    return () => window.removeEventListener(FLUSH_EDITS_EVENT, flush);
  }, []);

  const markDirty = () => setUncommitted(true);

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
      applyIdle({ type: "structural" });
      const lineIndex = startMap.lineIndex;
      const line = lines[lineIndex] ?? "";
      const nextLine = toggleNoteRange(line, startMap.local, endMap.local);
      const nextLines = [...lines];
      nextLines[lineIndex] = nextLine;
      paint(el, nextLines);
      setDomEmpty(isDomEmpty(el));
      onCommit(nextLines.length === 0 ? null : nextLines);
    } else {
      const current = serializeEditable(el, false);
      if (current === null) return;
      applyIdle({ type: "structural" });
      // Text mode yields InlineContent (string | TextRun[]), never a line list.
      const inline = (
        Array.isArray(current) && !isRunArray(current)
          ? (current as InlineContent[]).map((l) => plainText(l)).join("\n")
          : current
      ) as InlineContent;
      const next = toggleNoteRange(inline, saved.start, saved.end);
      paint(el, next);
      setDomEmpty(isDomEmpty(el));
      onCommit(plainText(next).length === 0 ? null : next);
    }
    setUncommitted(false);
    setToolbar(null);
    el.focus();
    // Same-cell commit: do not leave skip-blur-commit armed for later typing.
    skipBlurCommitRef.current = false;
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as HTMLElement | null;
    const decision = editableBlurDecision({
      relatedIsNoteToolbar: Boolean(
        related?.closest?.(".inline-note-toolbar") ||
          related?.closest?.(".context-menu-dropdown") ||
          related?.closest?.(".mantine-Menu-dropdown"),
      ),
      skipBlurCommit: skipBlurCommitRef.current,
      dirty: dirtyRef.current,
    });
    if (decision === "ignore-toolbar") {
      return;
    }
    applyIdle({ type: "blur" });
    if (decision === "skip-commit") {
      skipBlurCommitRef.current = false;
      setFocused(false);
      onFocusChange?.(blockId, false);
      setToolbar(null);
      return;
    }
    setFocused(false);
    onFocusChange?.(blockId, false);
    setToolbar(null);

    if (decision === "keep-dom") {
      skipSyncOnBlurRef.current = true;
      setDomEmpty(isDomEmpty(e.currentTarget));
      return;
    }

    setDomEmpty(isDomEmpty(e.currentTarget));
    commitIfDirty();
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
        dir={dir}
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

          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            if (e.nativeEvent.isComposing) return;
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            if (!onArrowLeave) return;
            const el = ref.current;
            if (!el) return;
            const edge = e.key === "ArrowUp" ? "first" : "last";
            if (!caretOnBoundaryLine(el, edge)) return;
            const moved = onArrowLeave(
              e.key === "ArrowUp" ? "up" : "down",
              caretClientX(el),
            );
            if (moved) e.preventDefault();
            return;
          }

          if (e.key === "Backspace" || e.key === "Delete") {
            if (e.nativeEvent.isComposing) return;
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            const el = ref.current;
            if (!onJoin || !el) return;
            const backward = e.key === "Backspace";
            if (!caretAtEdge(el, backward ? "start" : "end")) return;
            const outcome = onJoin(
              backward ? "backward" : "forward",
              readContent(),
            );
            if (!outcome) return;
            e.preventDefault();
            applyIdle({ type: "structural" });
            if (outcome.kind === "removed") {
              skipBlurCommitRef.current = true;
              return;
            }
            // This cell survives the merge; show the joined text, caret at the seam.
            paint(el, outcome.content);
            setUncommitted(false);
            setDomEmpty(isDomEmpty(el));
            const range = createRangeFromOffsets(el, outcome.caret, outcome.caret);
            const sel = window.getSelection();
            if (range && sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
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

          if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            if (!onSpillToNext) return;
            e.preventDefault();
            const content = readContent();
            const el = ref.current;
            const offsets = el ? getSelectionOffsets(el) : null;
            const { before, after } = splitEditorContent(
              content,
              offsets?.start ?? Number.POSITIVE_INFINITY,
              offsets?.end ?? Number.POSITIVE_INFINITY,
              lineMode,
            );
            const spilled = onSpillToNext(before, after);
            if (!spilled) return;
            applyIdle({ type: "structural" });
            skipBlurCommitRef.current = true;
            if (el) {
              paint(el, before ?? (lineMode ? [] : ""));
              setDomEmpty(isDomEmpty(el));
              setUncommitted(false);
            }
            return;
          }

          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if (!onInsertBelow) return;

          e.preventDefault();
          const content = readContent();
          const el = ref.current;
          const offsets = el ? getSelectionOffsets(el) : null;
          const start = offsets?.start ?? Number.POSITIVE_INFINITY;
          const end = offsets?.end ?? Number.POSITIVE_INFINITY;
          const { before, after } = splitEditorContent(content, start, end, lineMode);
          if (onInsertBelow(before, after, { content, start, end }) === false) return;
          applyIdle({ type: "structural" });
          skipBlurCommitRef.current = true;
          // contenteditable keeps the full text while focused; write `before`
          // now so the remainder is not still visible in this block.
          if (el) {
            paint(el, before ?? (lineMode ? [] : ""));
            setDomEmpty(isDomEmpty(el));
            setUncommitted(false);
          }
        }}
        onInput={(e) => {
          markDirty();
          const el = ref.current;
          if (el) setDomEmpty(isDomEmpty(el));
          updateToolbar();
          applyIdle({
            type: "input",
            isComposing: nativeEventIsComposing(e.nativeEvent),
          });
        }}
        onCompositionEnd={() => {
          applyIdle({ type: "compositionend" });
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
          applyIdle({ type: "paste" });
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
            armTransientSkipBlurCommit(skipBlurCommitRef);
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
              armTransientSkipBlurCommit(skipBlurCommitRef);
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

type BlockRowActions = {
  openBlockMenu: (
    e: ReactMouseEvent<HTMLDivElement>,
    index: number,
    kind: string,
    blockId: string,
    speaker: string | undefined,
  ) => void;
  toggleSpeakerUi: (blockId: string, anchor: SpeakerUi["anchor"]) => void;
  closeSpeakerUi: () => void;
  selectSpeaker: (blockId: string, id: string | null) => void;
  openMoreSpeakers: () => void;
  openMoreKinds?: () => void;
  openKindUi: (blockId: string) => void;
  handleKindIdle: () => void;
  changeKind: (index: number, kind: string) => void;
  groupScopeFor: (blockId: string) => KindGroupScope | null;
  onRenameKind: (from: string, to: string) => void;
  onDeleteKind: (kind: string) => void;
  onSetKindSpeaker: (kind: string, allowed: boolean) => void;
  handleFocusChange: (blockId: string, focused: boolean) => void;
  getCommitHandler: (
    blockId: string,
    col: ActiveVariant,
  ) => (content: InlineContent | InlineContent[] | null) => void;
  getInsertHandler: (
    blockId: string,
    col: ActiveVariant,
  ) => (
    before: InlineContent | InlineContent[] | null,
    after: InlineContent | InlineContent[] | null,
    split: SplitPoint,
  ) => boolean | void;
  getSpillHandler: (
    blockId: string,
    col: ActiveVariant,
  ) => (
    before: InlineContent | InlineContent[] | null,
    after: InlineContent | InlineContent[] | null,
  ) => boolean;
  getArrowLeaveHandler: (
    blockId: string,
    col: ActiveVariant,
  ) => (direction: "up" | "down", clientX: number) => boolean;
  getJoinHandler: (
    blockId: string,
    col: ActiveVariant,
  ) => (
    direction: JoinDirection,
    current: InlineContent | InlineContent[] | null,
  ) => JoinOutcome;
  moveBlock: (index: number, dir: -1 | 1) => void;
  requestDeleteBlock: (index: number) => void;
  /** Import draft: "delete" leaves the block out (it can be restored). */
  leavesOut: boolean;
  /** Position of this Block object in the structure last rendered. */
  indexOf: (block: Block) => number;
};

type BlockRowProps = {
  block: Block;
  /** First / last Block: rows get no index, so a split or move re-renders
   * only the rows it changes. Actions look the position up when they run. */
  first: boolean;
  last: boolean;
  lineMode: boolean;
  styleCss: CSSProperties;
  blockStyle: KindStyle;
  blockIssues: BlockIssues | undefined;
  showSpeakerTrigger: boolean;
  chipText: string | null;
  chipName: string | null;
  kinds: string[];
  speakerOpts: { id: string; chip: string; name: string }[];
  visibleVariants: ActiveVariant[];
  visibleKey: string;
  rtlByVisible: boolean[];
  rtlKey: string;
  split: boolean;
  /** A lead cell is shown (its content comes from RowSlotsContext). */
  hasLead: boolean;
  marked: boolean;
  indicate: boolean;
  jumpTarget: boolean;
  kindMenuOpen: boolean;
  speakerUi: SpeakerUi | null;
  noteColor: string;
  styleEditing: StyleEditing;
  kindDefs: KindDef[] | undefined;
  edits?: EditorEdits;
  actionsRef: { current: BlockRowActions };
};

function sameBlockRowProps(prev: BlockRowProps, next: BlockRowProps): boolean {
  if (prev.block !== next.block) return false;
  if (prev.first !== next.first || prev.last !== next.last) return false;
  if (prev.lineMode !== next.lineMode) return false;
  if (prev.styleCss !== next.styleCss || prev.blockStyle !== next.blockStyle) {
    return false;
  }
  if (prev.blockIssues !== next.blockIssues) return false;
  if (prev.showSpeakerTrigger !== next.showSpeakerTrigger) return false;
  if (prev.chipText !== next.chipText || prev.chipName !== next.chipName) {
    return false;
  }
  if (prev.split !== next.split || prev.marked !== next.marked) return false;
  if (prev.indicate !== next.indicate || prev.jumpTarget !== next.jumpTarget) {
    return false;
  }
  if (prev.kindMenuOpen !== next.kindMenuOpen) return false;
  if (prev.speakerUi !== next.speakerUi) return false;
  if (prev.noteColor !== next.noteColor) return false;
  if (prev.visibleKey !== next.visibleKey || prev.rtlKey !== next.rtlKey) {
    return false;
  }
  if (prev.hasLead !== next.hasLead) return false;
  if (prev.edits !== next.edits) return false;
  if (prev.kindDefs !== next.kindDefs) return false;
  if (prev.kinds !== next.kinds && (prev.kindMenuOpen || next.kindMenuOpen)) {
    return false;
  }
  if (
    prev.speakerOpts !== next.speakerOpts &&
    (prev.speakerUi || next.speakerUi)
  ) {
    return false;
  }
  if (
    prev.styleEditing !== next.styleEditing &&
    (prev.kindMenuOpen || next.kindMenuOpen)
  ) {
    return false;
  }
  return true;
}

/**
 * leadCell / rowsAfter are new functions on every parent render (their output
 * depends on import state). Passing them through context re-renders only
 * these slots, not the memoized rows and their editable cells.
 */
type RowSlots = {
  leadCell?: (blockId: string) => ReactNode;
  rowsAfter?: (blockId: string | null) => ReactNode;
};

const RowSlotsContext = createContext<RowSlots>({});

function RowLeadCell({ blockId }: { blockId: string }) {
  const { leadCell } = useContext(RowSlotsContext);
  return <>{leadCell?.(blockId)}</>;
}

function RowsAfterSlot({ blockId }: { blockId: string }) {
  const { rowsAfter } = useContext(RowSlotsContext);
  return <>{rowsAfter?.(blockId)}</>;
}

const BlockRow = memo(function BlockRow({
  block,
  first,
  last,
  lineMode,
  styleCss,
  blockStyle,
  blockIssues,
  showSpeakerTrigger,
  chipText,
  chipName,
  kinds,
  speakerOpts,
  visibleVariants,
  rtlByVisible,
  split,
  hasLead,
  marked,
  indicate,
  jumpTarget,
  kindMenuOpen,
  speakerUi,
  noteColor,
  styleEditing,
  kindDefs,
  edits,
  actionsRef,
}: BlockRowProps) {
  const [hovered, setHovered] = useState(false);
  const speakerChrome = speakerUi?.anchor === "chrome";
  const showChrome = hovered || kindMenuOpen || speakerChrome;
  const a = actionsRef.current;

  return (
    <Fragment>
      <div
        className="inline-block"
        data-block-id={block.id}
        data-lead={hasLead ? "true" : undefined}
        data-marked={marked ? "true" : undefined}
        data-invalid={blockIssues ? "true" : undefined}
        onContextMenu={(e) =>
          a.openBlockMenu(e, a.indexOf(block), block.kind, block.id, block.speaker)
        }
        data-indicate={indicate ? "true" : undefined}
        data-jump-target={jumpTarget ? "true" : undefined}
        data-menu-open={
          kindMenuOpen || speakerUi ? "true" : undefined
        }
        data-split={split ? "true" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest(".inline-block-chrome")) return;
          if (target.closest(".inline-lead")) return;
          if (target.closest(".inline-content")) return;
          if (target.closest(".inline-note-toolbar")) return;
          if (target.closest(".speaker-chip")) return;
          if (target.closest("[role='dialog']")) return;
          if (target.closest(".mantine-Popover-dropdown")) return;
          if (target.closest(".mantine-Combobox-dropdown")) return;

          const row = e.currentTarget.querySelector(".split-row");
          if (!row) return;
          const cells = [...row.querySelectorAll<HTMLElement>(".split-cell")];
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
        }}
      >
        {showChrome ? (
          <div className="inline-block-chrome">
            {showSpeakerTrigger ? (
              speakerUi && speakerChrome ? (
                <SpeakerMenu
                  opened
                  onClose={a.closeSpeakerUi}
                  value={block.speaker}
                  options={speakerOpts}
                  onSelect={(id) => a.selectSpeaker(block.id, id)}
                  onMore={a.openMoreSpeakers}
                >
                  <SpeakerTrigger
                    name={chipName}
                    onClick={() => a.toggleSpeakerUi(block.id, "chrome")}
                  />
                </SpeakerMenu>
              ) : (
                <SpeakerTrigger
                  name={chipName}
                  onClick={() => a.toggleSpeakerUi(block.id, "chrome")}
                />
              )
            ) : null}
            {kindMenuOpen ? (
              <KindSelect
                key={block.id}
                compact
                defaultOpen
                value={block.kind}
                options={kinds}
                styleEditing={styleEditing}
                onIdle={a.handleKindIdle}
                onChange={(kind) => a.changeKind(a.indexOf(block), kind)}
                groupScope={a.groupScopeFor(block.id)}
                onMoreKinds={a.openMoreKinds}
                onRename={(from, to) => {
                  a.onRenameKind(from, to);
                }}
                onDelete={a.onDeleteKind}
                kindDefs={kindDefs}
                onSpeakerChange={a.onSetKindSpeaker}
              />
            ) : (
              <KindTrigger
                compact
                value={block.kind}
                onClick={() => a.openKindUi(block.id)}
              />
            )}
            {blockIssues ? (
              <Tooltip
                label={blockIssues.messages.join("\n")}
                withArrow
                multiline
                maw={320}
                style={{ whiteSpace: "pre-line" }}
              >
                <span
                  className="inline-block-issue"
                  role="img"
                  aria-label={`${blockIssues.messages.length} validation problem${blockIssues.messages.length === 1 ? "" : "s"}`}
                >
                  <IconAlertTriangle size={14} stroke={2} />
                </span>
              </Tooltip>
            ) : null}
            <Group gap={2}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => a.moveBlock(a.indexOf(block), -1)}
                disabled={first}
                aria-label="Move up"
              >
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => a.moveBlock(a.indexOf(block), 1)}
                disabled={last}
                aria-label="Move down"
              >
                <IconArrowDown size={14} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                color={a.leavesOut ? "gray" : "accent"}
                onClick={() => a.requestDeleteBlock(a.indexOf(block))}
                aria-label={a.leavesOut ? "Leave out" : "Delete block"}
                title={a.leavesOut ? "Leave out" : undefined}
              >
                {a.leavesOut ? <IconCircleOff size={14} /> : <IconTrash size={14} />}
              </ActionIcon>
            </Group>
          </div>
        ) : null}

        {hasLead ? (
          <div className="inline-lead">
            <RowLeadCell blockId={block.id} />
          </div>
        ) : null}
        <div className="split-row">
          {visibleVariants.map((col, colIndex) => {
            const tr = block.translations.find(
              (t) => t.lang === col.lang && t.variant === col.variant,
            );
            const content = translationEditorContent(block.kind, tr);
            const dir = resolveDir(
              rtlByVisible[colIndex] ? true : undefined,
              blockStyle.dir,
            );
            const showChip = colIndex === 0 && chipText !== null;
            const chip = showChip ? (
              <SpeakerChip
                chip={chipText}
                name={chipName ?? ""}
                dir={dir}
                fontSize={styleCss.fontSize}
                onClick={() => a.toggleSpeakerUi(block.id, "chip")}
              />
            ) : null;

            return (
              <div
                key={variantKey(col)}
                className="split-cell"
                data-speaker={showChip ? "true" : undefined}
                data-lang={col.lang}
                data-variant={col.variant}
                data-invalid={
                  blockIssues?.variantKeys.has(variantKey(col))
                    ? "true"
                    : undefined
                }
              >
                {chip &&
                speakerUi?.blockId === block.id &&
                speakerUi.anchor === "chip" ? (
                  <SpeakerMenu
                    opened
                    onClose={a.closeSpeakerUi}
                    value={block.speaker}
                    options={speakerOpts}
                    onSelect={(id) => a.selectSpeaker(block.id, id)}
                    onMore={a.openMoreSpeakers}
                  >
                    {chip}
                  </SpeakerMenu>
                ) : (
                  chip
                )}
                <EditableBlock
                  content={content}
                  lineMode={lineMode}
                  editorKey={editorKey(block.id, col)}
                  blockId={block.id}
                  placeholder={kindDisplayLabel(block.kind)}
                  style={styleCss}
                  noteColor={noteColor}
                  initialCap={blockStyle.initialCap === "true"}
                  dir={dir}
                  onFocusChange={a.handleFocusChange}
                  onCommit={a.getCommitHandler(block.id, col)}
                  onInsertBelow={a.getInsertHandler(block.id, col)}
                  onSpillToNext={
                    edits ? undefined : a.getSpillHandler(block.id, col)
                  }
                  onArrowLeave={a.getArrowLeaveHandler(block.id, col)}
                  onJoin={a.getJoinHandler(block.id, col)}
                />
              </div>
            );
          })}
        </div>
      </div>
      <RowsAfterSlot blockId={block.id} />
    </Fragment>
  );
}, sameBlockRowProps);

export const InlineEditor = forwardRef<InlineEditorHandle, Props>(
  function InlineEditor(
    {
      prayer,
      visibleVariants,
      styles,
      styleEditing,
      issues,
      onChange,
      onRenameKind,
      onDeleteKind,
      onSetKindSpeaker,
      onOpenSettings,
      edits,
      leadCell,
      rowsAfter,
      markedBlocks,
    },
    ref,
  ) {
  const [kindUiBlockId, setKindUiBlockId] = useState<string | null>(null);
  const [speakerUi, setSpeakerUi] = useState<SpeakerUi | null>(null);
  const caretRestoreRef = useRef<CaretRestore | null>(null);
  const contextMenu = useContextMenu();
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  const [lastAddedKind, setLastAddedKind] = useState("verse");
  const layoutRef = useRef<HTMLDivElement>(null);
  const focusedIdRef = useRef<string | null>(null);
  const rowActionsRef = useRef<BlockRowActions>(null!);
  const rowSlots = useMemo(
    () => ({ leadCell, rowsAfter }),
    [leadCell, rowsAfter],
  );
  const renderedStructureRef = useRef(prayer.structure);
  renderedStructureRef.current = prayer.structure;
  const kindUiBlockIdRef = useRef<string | null>(null);
  kindUiBlockIdRef.current = kindUiBlockId;

  // Presets + this prayer's declared kinds (in `kinds` order).
  const kinds = useMemo(() => pickerKinds(prayer), [prayer.kinds]);
  // The last added kind may have been deleted from this prayer since.
  const nextAddKind = kinds.includes(lastAddedKind) ? lastAddedKind : "verse";
  const split = visibleVariants.length > 1;
  const firstCol = visibleVariants[0];
  const speakerOpts = useMemo(
    () => speakerOptions(prayer, firstCol),
    // Speaker ids live on blocks, labels on variants.
    [prayer.structure, prayer.variants, firstCol],
  );
  // One CSS object per Kind style object: rows stay memoized across
  // structure edits (a split or merge used to restyle every cell).
  const cssCacheRef = useRef(new WeakMap<KindStyle, CSSProperties>());
  const cssFor = (style: KindStyle): CSSProperties => {
    let css = cssCacheRef.current.get(style);
    if (!css) {
      css = styleToCss(style);
      cssCacheRef.current.set(style, css);
    }
    return css;
  };

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
    styles,
    edits,
  });
  ctxRef.current = {
    prayer,
    onChange,
    styleEditing,
    onRenameKind,
    visibleVariants,
    styles,
    edits,
  };
  const flushedCtx = () => snapshotAfterFlush(flushPendingEdits, ctxRef);

  const handlersRef = useRef({
    commit: new Map<string, (c: InlineContent | InlineContent[] | null) => void>(),
    insert: new Map<
      string,
      (
        before: InlineContent | InlineContent[] | null,
        after: InlineContent | InlineContent[] | null,
        split: SplitPoint,
      ) => boolean | void
    >(),
    spill: new Map<
      string,
      (
        before: InlineContent | InlineContent[] | null,
        after: InlineContent | InlineContent[] | null,
      ) => boolean
    >(),
    join: new Map<
      string,
      (
        direction: JoinDirection,
        current: InlineContent | InlineContent[] | null,
      ) => JoinOutcome
    >(),
    arrowLeave: new Map<
      string,
      (direction: "up" | "down", clientX: number) => boolean
    >(),
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
      } else if (options.scroll === "nearest") {
        const focusTarget = options.focusCol
          ? root.querySelector<HTMLElement>(
              `[data-editor="${CSS.escape(editorKey(blockId, options.focusCol))}"]`,
            )
          : null;
        (focusTarget ?? blockEl).scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "nearest",
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
        const caret = options.caret;
        if (caret && typeof caret === "object") {
          placeCaretOnLine(editable, caret.line, caret.x);
        } else if (caret === "start") {
          placeCaretAtStart(editable);
        } else {
          placeCaretAtEnd(editable);
        }
      }
    },
    [],
  );

  const closeSpeakerUi = useCallback(() => {
    setSpeakerUi(null);
    const restore = caretRestoreRef.current;
    caretRestoreRef.current = null;
    if (!restore) return;
    // Back to the caret the shortcut was pressed at (after the menu unmounts).
    requestAnimationFrame(() => {
      const root = layoutRef.current;
      const el = root?.querySelector<HTMLElement>(
        `[data-editor="${CSS.escape(restore.editor)}"]`,
      );
      if (!el) return;
      restoreSelectionOffsets(el, restore.start, restore.end);
    });
  }, []);

  const toggleSpeakerUi = (blockId: string, anchor: SpeakerUi["anchor"]) => {
    caretRestoreRef.current = null;
    setSpeakerUi((cur) =>
      cur?.blockId === blockId && cur.anchor === anchor
        ? null
        : { blockId, anchor },
    );
  };

  const selectSpeaker = (blockId: string, id: string | null) => {
    const { prayer: p, onChange: change, edits: ed } = flushedCtx();
    const block = p.structure.find((b) => b.id === blockId);
    if (!block || (block.speaker ?? null) === id) return;
    if (ed) return ed.setSpeaker(blockId, id);
    // No coalesce key: every speaker change is its own undo step.
    change(setBlockSpeaker(p, blockId, id));
  };

  const openMoreSpeakers = () => {
    caretRestoreRef.current = null;
    onOpenSettings?.("speakers");
  };

  const openMoreKinds = onOpenSettings
    ? () => onOpenSettings("kinds")
    : undefined;

  const openSpeakerMenu = useCallback((): boolean => {
    const { prayer: p, visibleVariants: cols } = ctxRef.current;
    const active = document.activeElement as HTMLElement | null;
    const root = layoutRef.current;
    const inEditor =
      active && root?.contains(active) ? active.closest<HTMLElement>("[data-editor]") : null;
    const blockId =
      inEditor?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ??
      focusedIdRef.current;
    if (!blockId) return false;
    const block = p.structure.find((b) => b.id === blockId);
    if (!block) return false;
    if (
      block.speaker === undefined &&
      !kindAllowsSpeaker(block.kind, ctxRef.current.prayer)
    ) {
      return false;
    }
    const offsets = inEditor ? getSelectionOffsets(inEditor) : null;
    caretRestoreRef.current =
      inEditor?.dataset.editor && offsets
        ? { editor: inEditor.dataset.editor, ...offsets }
        : null;
    setSpeakerUi({
      blockId,
      anchor: block.speaker !== undefined && cols[0] ? "chip" : "chrome",
    });
    return true;
  }, []);

  useImperativeHandle(ref, () => ({ revealBlock, openSpeakerMenu }), [
    revealBlock,
    openSpeakerMenu,
  ]);

  const focusEditor = useCallback(
    (
      blockId: string,
      col: ActiveVariant,
      caret: "start" | "end" = "end",
    ) => {
      revealBlock(blockId, {
        scroll: "smooth-center",
        focusCol: col,
        flash: true,
        caret,
      });
    },
    [revealBlock],
  );

  // No confirm: deleting is one undo step (Cmd/Ctrl+Z).
  const requestDeleteBlock = (index: number) => {
    const { prayer: p, onChange: change, edits: ed } = flushedCtx();
    const id = p.structure[index]?.id;
    if (ed) return void (id && ed.remove(id));
    change(removeBlock(p, index));
  };

  const focusEditorRef = useRef(focusEditor);
  focusEditorRef.current = focusEditor;

  const getCommitHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.commit.get(key);
    if (!fn) {
      fn = (next) => {
        const { prayer: p, onChange: change, edits: ed } = ctxRef.current;
        if (ed) return ed.commit(blockId, col, next);
        const updated = applyCommittedContent(p, blockId, col, next);
        // Same-turn readers (Block menu after flush) must see this Prayer.
        rememberCtxPrayer(ctxRef, updated);
        change(updated, {
          coalesceKey: key,
        });
      };
      handlersRef.current.commit.set(key, fn);
    }
    return fn;
  };

  const getInsertHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.insert.get(key);
    if (!fn) {
      fn = (before, after, at) => {
        const { prayer: p, onChange: change, edits: ed } = ctxRef.current;
        if (ed) {
          const id = ed.split(blockId, col, at);
          if (id === null) return false;
          window.setTimeout(() => focusEditorRef.current(id, col, "start"), 0);
          return true;
        }
        const index = p.structure.findIndex((b) => b.id === blockId);
        if (index < 0) return false;
        const current = p.structure[index];
        if (!current) return false;
        const id = createBlockId(p.structure.length);
        const updated = splitBlockInPrayer(p, index, col, before, after, id);
        setLastAddedKind(current.kind);
        change(updated);
        const caret = after === null ? "end" : "start";
        window.setTimeout(() => focusEditorRef.current(id, col, caret), 0);
        return true;
      };
      handlersRef.current.insert.set(key, fn);
    }
    return fn;
  };

  const getSpillHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.spill.get(key);
    if (!fn) {
      fn = (before, after) => {
        const { prayer: p, onChange: change } = ctxRef.current;
        const index = p.structure.findIndex((b) => b.id === blockId);
        if (index < 0) return false;
        const nextBlock = p.structure[index + 1];
        if (!nextBlock) return false;
        const updated = moveRemainderToNext(p, index, col, before, after);
        if (!updated) return false;
        change(updated);
        window.setTimeout(
          () => focusEditorRef.current(nextBlock.id, col, "start"),
          0,
        );
        return true;
      };
      handlersRef.current.spill.set(key, fn);
    }
    return fn;
  };

  const getArrowLeaveHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.arrowLeave.get(key);
    if (!fn) {
      fn = (direction, clientX) => {
        const { prayer: p } = ctxRef.current;
        const index = p.structure.findIndex((b) => b.id === blockId);
        if (index < 0) return false;
        const target = p.structure[direction === "up" ? index - 1 : index + 1];
        if (!target) return false;
        revealBlock(target.id, {
          scroll: "nearest",
          focusCol: col,
          flash: false,
          caret: {
            x: clientX,
            line: direction === "up" ? "end" : "start",
          },
        });
        return true;
      };
      handlersRef.current.arrowLeave.set(key, fn);
    }
    return fn;
  };

  const getJoinHandler = (blockId: string, col: ActiveVariant) => {
    const key = editorKey(blockId, col);
    let fn = handlersRef.current.join.get(key);
    if (!fn) {
      fn = (direction, current) => {
        const { prayer: before, onChange: change, edits: ed } = ctxRef.current;
        if (ed) {
          const outcome = ed.join(blockId, col, direction, current);
          if (outcome?.kind === "removed") {
            const index = before.structure.findIndex((b) => b.id === blockId);
            const up = direction === "backward" ? index > 0 : index === before.structure.length - 1;
            const focusId = before.structure[up ? index - 1 : index + 1]?.id;
            if (focusId) {
              window.setTimeout(
                () => focusEditorRef.current(focusId, col, up ? "end" : "start"),
                0,
              );
            }
          }
          return outcome;
        }
        const index = before.structure.findIndex((b) => b.id === blockId);
        if (index < 0) return null;
        const backward = direction === "backward";
        const neighbour = before.structure[backward ? index - 1 : index + 1];
        const p = applyCommittedContent(before, blockId, col, current);

        // A Block empty in every Variant just goes away.
        if (isBlockEmptyAcrossVariants(p, blockId)) {
          // Prefer the Block in the key's direction; caret lands next to the gap.
          const focusUp = backward ? index > 0 : !neighbour;
          const focusId = before.structure[focusUp ? index - 1 : index + 1]?.id;
          if (!focusId) return null;
          change(removeBlock(p, index));
          const caret = focusUp ? "end" : "start";
          window.setTimeout(() => focusEditorRef.current(focusId, col, caret), 0);
          return { kind: "removed" };
        }

        if (!neighbour) return null;
        const merged = mergeBlocks(
          p,
          backward ? index - 1 : index,
          backward ? "lower" : "upper",
          col,
        );
        if (!merged) return null;
        // Pending typing first, so undo steps back to the two Blocks as typed.
        if (p !== before) change(p, { coalesceKey: key });
        change(merged.prayer);
        const block = merged.prayer.structure.find((b) => b.id === merged.blockId)!;
        return {
          kind: "merged",
          content: translationEditorContent(
            block.kind,
            getTranslation(merged.prayer, block.id, col),
          ),
          caret: merged.caret,
        };
      };
      handlersRef.current.join.set(key, fn);
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
      handlersRef.current.spill,
      handlersRef.current.join,
      handlersRef.current.arrowLeave,
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

  const addBlock = (kind: string = nextAddKind) => {
    const { prayer: p, onChange: change, visibleVariants: cols } = flushedCtx();
    const id = createBlockId(p.structure.length);
    const col = cols[0];
    setLastAddedKind(kind);
    change(addBlockToPrayer(p, kind, id));
    if (col) {
      window.setTimeout(() => focusEditor(id, col), 0);
    }
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const { prayer: p, onChange: change, edits: ed } = flushedCtx();
    const id = p.structure[index]?.id;
    if (ed) return void (id && ed.move(id, dir));
    change(moveBlockInPrayer(p, index, dir));
  };

  const changeKind = (index: number, kind: string) => {
    const { prayer: p, onChange: change, edits: ed } = flushedCtx();
    const id = p.structure[index]?.id;
    if (ed) return void (id && ed.setKind(id, kind));
    change(setBlockKind(p, index, kind));
  };

  const groupScopeFor = (blockId: string): KindGroupScope | null => {
    const scope = edits?.kindGroup?.(blockId) ?? null;
    if (!scope) return null;
    return {
      ...scope,
      onChangeGroup: (kind) => {
        flushedCtx();
        scope.onChangeGroup(kind);
      },
    };
  };

  const insertBlockAfter = (index: number, kind: string) => {
    const { prayer: p, onChange: change, visibleVariants: cols } = flushedCtx();
    const id = createBlockId(p.structure.length);
    const col = cols[0];
    const added = addBlockToPrayer(p, kind, id);
    // addBlock appends; move the new block up to sit below `index`.
    const structure = [...added.structure];
    const [block] = structure.splice(structure.length - 1, 1);
    structure.splice(index + 1, 0, block!);
    setLastAddedKind(kind);
    change({ ...added, structure });
    if (col) window.setTimeout(() => focusEditor(id, col), 0);
  };

  const openBlockMenu = (
    e: ReactMouseEvent<HTMLDivElement>,
    index: number,
    kind: string,
    blockId: string,
    speaker: string | undefined,
  ) => {
    const target = e.target as HTMLElement;
    // Dropdowns portal out but still bubble React events through the tree.
    if (!e.currentTarget.contains(target)) return;
    const editor = target.closest(".inline-content") as HTMLElement | null;
    const inText = editor !== null;
    const offsets = editor ? getSelectionOffsets(editor) : null;
    const hasSelection = Boolean(offsets && offsets.start !== offsets.end);
    const api = getToolkitApi();
    const runTextEdit = (action: "cut" | "copy" | "paste") => {
      if (!editor) return;
      if (offsets) {
        void runEditorClipboardAction(action, editor, offsets, () =>
          api.runEdit("paste"),
        );
        return;
      }
      editor.focus();
      void api.runEdit(action);
    };
    const items: ContextMenuItem[] = [];
    if (inText) {
      items.push(
        {
          label: "Cut",
          icon: <IconCut size={14} />,
          shortcut: shortcutLabel("Mod+X"),
          disabled: !hasSelection,
          onClick: () => runTextEdit("cut"),
        },
        {
          label: "Copy",
          icon: <IconCopy size={14} />,
          shortcut: shortcutLabel("Mod+C"),
          disabled: !hasSelection,
          onClick: () => runTextEdit("copy"),
        },
        {
          label: "Paste",
          icon: <IconClipboard size={14} />,
          shortcut: shortcutLabel("Mod+V"),
          onClick: () => runTextEdit("paste"),
        },
        { divider: true },
      );
    }
    items.push({
      label: "Kind",
      icon: <IconPalette size={14} />,
      submenu: kindContextItems({
        value: kind,
        options: kinds,
        onSelect: (next) => changeKind(index, next),
        onMore: openMoreKinds,
      }),
    });
    if (speaker !== undefined || kindAllowsSpeaker(kind, prayer)) {
      items.push({
        label: "Speaker",
        icon: <IconUser size={14} />,
        shortcut: shortcutLabel(SPEAKER_SHORTCUT),
        submenu: speakerContextItems({
          value: speaker,
          options: speakerOpts,
          onSelect: (id) => selectSpeaker(blockId, id),
          onMore: openMoreSpeakers,
        }),
      });
    }
    items.push({ divider: true });
    if (!edits) {
      items.push({
        label: `Add ${kindDisplayLabel(kind)} below`,
        icon: <IconRowInsertBottom size={14} />,
        onClick: () => insertBlockAfter(index, kind),
      });
    }
    items.push(
      {
        label: "Move up",
        icon: <IconArrowUp size={14} />,
        disabled: index === 0,
        onClick: () => moveBlock(index, -1),
      },
      {
        label: "Move down",
        icon: <IconArrowDown size={14} />,
        disabled: index === prayer.structure.length - 1,
        onClick: () => moveBlock(index, 1),
      },
      { divider: true },
      {
        label: edits ? "Leave out" : "Delete block",
        icon: edits ? <IconCircleOff size={14} /> : <IconTrash size={14} />,
        color: edits ? undefined : "accent",
        onClick: () => requestDeleteBlock(index),
      },
    );
    contextMenu.open(e, items);
  };

  // Column header fill (n blocks × columns); only the structure changes it.
  const fillByCol = useMemo(
    () => (split ? visibleVariants.map((col) => fillPercent(prayer, col)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prayer.structure, visibleVariants, split],
  );
  const visibleKey = visibleVariants.map((col) => variantKey(col)).join("\0");
  const rtlByVisible = visibleVariants.map((col) => {
    const meta = prayer.variants.find((v) => sameVariant(v, col));
    return meta?.rtl === true;
  });
  const rtlKey = rtlByVisible.map((flag) => (flag ? "1" : "0")).join("");
  rowActionsRef.current = {
    openBlockMenu,
    toggleSpeakerUi,
    closeSpeakerUi,
    selectSpeaker,
    openMoreSpeakers,
    openMoreKinds,
    openKindUi: (blockId) => setKindUiBlockId(blockId),
    handleKindIdle,
    changeKind,
    groupScopeFor,
    onRenameKind,
    onDeleteKind,
    onSetKindSpeaker,
    handleFocusChange,
    getCommitHandler,
    getInsertHandler,
    getSpillHandler,
    getArrowLeaveHandler,
    getJoinHandler,
    moveBlock,
    requestDeleteBlock,
    leavesOut: Boolean(edits),
    indexOf: (block) => renderedStructureRef.current.indexOf(block),
  };

  return (
    <RowSlotsContext.Provider value={rowSlots}>
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
              {visibleVariants.map((col, colIndex) => {
                const { filled, total, percent } = fillByCol[colIndex]!;
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

        {rowsAfter?.(null)}
        {prayer.structure.map((block, index) => {
          const lineMode = usesLines(block.kind);
          const blockStyle = styles[block.kind] ?? FALLBACK_KIND_STYLE;
          const styleCss = cssFor(block.kind ? blockStyle : FALLBACK_KIND_STYLE);
          const blockIssues = issues?.get(block.id);
          const showSpeakerTrigger =
            block.speaker !== undefined ||
            kindAllowsSpeaker(block.kind, prayer);
          const speakerOpt =
            block.speaker !== undefined
              ? speakerOpts.find((o) => o.id === block.speaker)
              : undefined;
          const chipText =
            block.speaker !== undefined
              ? (speakerOpt?.chip ??
                (firstCol
                  ? speakerChipLabel(prayer, firstCol, block.speaker)
                  : block.speaker.charAt(0).toUpperCase()))
              : null;
          const chipName =
            speakerOpt?.name ??
            (block.speaker
              ? resolveSpeakerLabel(
                  prayer,
                  firstCol ??
                    prayer.variants[0] ?? { lang: "", variant: "" },
                  block.speaker,
                  "name",
                )
              : null);

          return (
            <BlockRow
              key={block.id}
              block={block}
              first={index === 0}
              last={index === prayer.structure.length - 1}
              lineMode={lineMode}
              styleCss={styleCss}
              blockStyle={blockStyle}
              blockIssues={blockIssues}
              showSpeakerTrigger={showSpeakerTrigger}
              chipText={chipText}
              chipName={chipName}
              kinds={kinds}
              speakerOpts={speakerOpts}
              visibleVariants={visibleVariants}
              visibleKey={visibleKey}
              rtlByVisible={rtlByVisible}
              rtlKey={rtlKey}
              split={split}
              hasLead={Boolean(leadCell)}
              marked={Boolean(markedBlocks?.has(block.id))}
              indicate={blockStyle.indicate === "true"}
              jumpTarget={jumpTargetId === block.id}
              kindMenuOpen={kindUiBlockId === block.id}
              speakerUi={speakerUi?.blockId === block.id ? speakerUi : null}
              noteColor={noteColor}
              styleEditing={styleEditing}
              kindDefs={prayer.kinds}
              edits={edits}
              actionsRef={rowActionsRef}
            />
          );
        })}
      </div>

      {edits ? null : (
      <div className="add-block">
        <button
          type="button"
          className="add-block-main"
          onClick={() => addBlock()}
        >
          <IconPlus size={14} stroke={2.2} />
          <span>Add {kindDisplayLabel(nextAddKind)}</span>
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
            {kinds.map((kind) => (
              <Menu.Item
                key={kind}
                onClick={() => addBlock(kind)}
                disabled={kind === nextAddKind}
              >
                {kindDisplayLabel(kind)}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </div>
      )}

      {contextMenu.menu}
    </Stack>
    </RowSlotsContext.Provider>
  );
  },
);
