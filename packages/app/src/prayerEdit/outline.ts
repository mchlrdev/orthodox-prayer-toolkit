import {
  plainText,
  type InlineContent,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";
import { getTranslation, translationEditorContent } from "./translations";

export type OutlineKind = "heading" | "subheading";

export type OutlineEntry = {
  blockId: string;
  kind: OutlineKind;
  /** Trimmed plain text; empty string means show Untitled in the UI. */
  label: string;
  children: OutlineEntry[];
};

export type OutlineAnchor = {
  blockId: string;
  kind: OutlineKind;
  /** Offset from the start of the scroll content. */
  top: number;
  orphan: boolean;
};

function isOutlineKind(kind: string): kind is OutlineKind {
  return kind === "heading" || kind === "subheading";
}

function labelForBlock(
  prayer: Prayer,
  blockId: string,
  kind: string,
  primary: ActiveVariant,
): string {
  const tr = getTranslation(prayer, blockId, primary);
  return plainText(
    translationEditorContent(kind, tr) as InlineContent,
  ).trim();
}

/** Build the Content outline tree from heading / subheading Blocks. */
export function buildPrayerOutline(
  prayer: Prayer,
  primary: ActiveVariant,
): OutlineEntry[] {
  const roots: OutlineEntry[] = [];
  let currentHeading: OutlineEntry | null = null;

  for (const block of prayer.structure) {
    if (!isOutlineKind(block.kind)) continue;

    const entry: OutlineEntry = {
      blockId: block.id,
      kind: block.kind,
      label: labelForBlock(prayer, block.id, block.kind, primary),
      children: [],
    };

    if (block.kind === "heading") {
      roots.push(entry);
      currentHeading = entry;
      continue;
    }

    if (currentHeading) {
      currentHeading.children.push(entry);
    } else {
      roots.push(entry);
    }
  }

  return roots;
}

/**
 * Pixel slack so a heading landed on the sticky reading line by outline jump
 * still counts as active when getBoundingClientRect reports it slightly below.
 */
export const OUTLINE_ACTIVE_THRESHOLD_SLACK_PX = 1;

/**
 * Scrollspy: last heading (or orphan root subheading) whose top is at or
 * above the scrollport top + sticky offset. Nested subheadings never win.
 */
export function resolveActiveOutlineId(
  anchors: OutlineAnchor[],
  scrollTop: number,
  headerOffset: number,
): string | null {
  const threshold =
    scrollTop + headerOffset + OUTLINE_ACTIVE_THRESHOLD_SLACK_PX;
  let active: string | null = null;

  for (const anchor of anchors) {
    if (anchor.top > threshold) break;
    if (anchor.kind === "heading" || anchor.orphan) {
      active = anchor.blockId;
    }
  }

  return active;
}

/** Flatten outline entries to document-order anchors (tops filled by caller). */
export function flattenOutlineEntries(
  entries: OutlineEntry[],
): Omit<OutlineAnchor, "top">[] {
  const out: Omit<OutlineAnchor, "top">[] = [];
  for (const entry of entries) {
    const orphan = entry.kind === "subheading";
    out.push({
      blockId: entry.blockId,
      kind: entry.kind,
      orphan,
    });
    for (const child of entry.children) {
      out.push({
        blockId: child.blockId,
        kind: child.kind,
        orphan: false,
      });
    }
  }
  return out;
}
