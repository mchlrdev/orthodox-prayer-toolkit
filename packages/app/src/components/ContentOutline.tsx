import { useEffect, useMemo, useState, type RefObject } from "react";
import { ActionIcon, ScrollArea, Tooltip } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
} from "@tabler/icons-react";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  buildPrayerOutline,
  flattenOutlineEntries,
  resolveActiveOutlineId,
  type OutlineEntry,
} from "../prayerEdit";
import type { ActiveVariant } from "../variant";

type Props = {
  prayer: Prayer | null;
  primary: ActiveVariant | null;
  scrollRootRef: RefObject<HTMLElement | null>;
  onJump: (blockId: string) => void;
};

function entryLabel(label: string): { text: string; untitled: boolean } {
  const trimmed = label.trim();
  if (!trimmed) return { text: "Untitled", untitled: true };
  return { text: trimmed, untitled: false };
}

function collectExpandableIds(entries: OutlineEntry[]): string[] {
  return entries
    .filter((e) => e.kind === "heading" && e.children.length > 0)
    .map((e) => e.blockId);
}

export function ContentOutline({
  prayer,
  primary,
  scrollRootRef,
  onJump,
}: Props) {
  const outline = useMemo(() => {
    if (!prayer || !primary) return [];
    return buildPrayerOutline(prayer, primary);
  }, [prayer, primary]);

  const expandableIds = useMemo(
    () => collectExpandableIds(outline),
    [outline],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  // Drop stale expand ids when structure changes; keep session choices for survivors.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const id of expandableIds) {
        if (prev.has(id)) next.add(id);
      }
      return next;
    });
  }, [expandableIds]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || outline.length === 0) {
      setActiveId(null);
      return;
    }

    const flat = flattenOutlineEntries(outline);

    const update = () => {
      const sticky = root.querySelector<HTMLElement>(".split-col-labels");
      const headerOffset = sticky?.offsetHeight ?? 0;
      const rootRect = root.getBoundingClientRect();
      const anchors = flat.flatMap((meta) => {
        const el = root.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(meta.blockId)}"]`,
        );
        if (!el) return [];
        const top =
          el.getBoundingClientRect().top - rootRect.top + root.scrollTop;
        return [{ ...meta, top }];
      });
      setActiveId(
        resolveActiveOutlineId(anchors, root.scrollTop, headerOffset),
      );
    };

    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [outline, scrollRootRef, prayer]);

  // Keep the active heading group expanded so the accent highlight is visible.
  useEffect(() => {
    if (!activeId) return;
    const parent = outline.find(
      (e) =>
        e.blockId === activeId ||
        e.children.some((c) => c.blockId === activeId),
    );
    if (!parent || parent.children.length === 0) return;
    setExpanded((prev) => {
      if (prev.has(parent.blockId)) return prev;
      const next = new Set(prev);
      next.add(parent.blockId);
      return next;
    });
  }, [activeId, outline]);

  const allExpanded =
    expandableIds.length > 0 &&
    expandableIds.every((id) => expanded.has(id));

  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(expandableIds));
    }
  };

  const toggleGroup = (blockId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  return (
    <div className="content-outline">
      <div className="sidebar-chrome">
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <span className="sidebar-folder">Content</span>
          </div>
          {expandableIds.length > 0 ? (
            <Tooltip
              label={allExpanded ? "Collapse all" : "Expand all"}
              withArrow
              openDelay={300}
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={allExpanded ? "Collapse all" : "Expand all"}
                onClick={toggleAll}
              >
                {allExpanded ? (
                  <IconChevronsUp size={16} stroke={1.75} />
                ) : (
                  <IconChevronsDown size={16} stroke={1.75} />
                )}
              </ActionIcon>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <ScrollArea className="content-outline-scroll" type="auto" offsetScrollbars>
        {outline.length === 0 ? (
          <p className="content-outline-empty">No heading</p>
        ) : (
          <ul className="content-outline-list">
            {outline.map((entry) => (
              <OutlineGroup
                key={entry.blockId}
                entry={entry}
                expanded={expanded.has(entry.blockId)}
                activeId={activeId}
                onToggle={() => toggleGroup(entry.blockId)}
                onJump={onJump}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function OutlineGroup({
  entry,
  expanded,
  activeId,
  onToggle,
  onJump,
}: {
  entry: OutlineEntry;
  expanded: boolean;
  activeId: string | null;
  onToggle: () => void;
  onJump: (blockId: string) => void;
}) {
  const hasChildren = entry.children.length > 0;
  const isGroup = entry.kind === "heading" && hasChildren;
  const { text, untitled } = entryLabel(entry.label);
  const active = activeId === entry.blockId;

  return (
    <li
      className={isGroup ? "content-outline-group" : "content-outline-item"}
      data-kind={entry.kind}
      data-expanded={isGroup && expanded ? "true" : undefined}
    >
      <div className="content-outline-row">
        <button
          type="button"
          className="content-outline-link"
          data-kind={entry.kind}
          data-active={active ? "true" : undefined}
          data-untitled={untitled ? "true" : undefined}
          onClick={() => onJump(entry.blockId)}
        >
          {text}
        </button>
        {isGroup ? (
          <button
            type="button"
            className="content-outline-chevron"
            aria-label={expanded ? "Collapse heading" : "Expand heading"}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? (
              <IconChevronDown size={14} stroke={2} />
            ) : (
              <IconChevronRight size={14} stroke={2} />
            )}
          </button>
        ) : null}
      </div>
      {isGroup && expanded ? (
        <ul className="content-outline-children">
          {entry.children.map((child) => {
            const childLabel = entryLabel(child.label);
            return (
              <li
                key={child.blockId}
                className="content-outline-item"
                data-kind="subheading"
              >
                <button
                  type="button"
                  className="content-outline-link"
                  data-kind="subheading"
                  data-active={
                    activeId === child.blockId ? "true" : undefined
                  }
                  data-untitled={childLabel.untitled ? "true" : undefined}
                  onClick={() => onJump(child.blockId)}
                >
                  {childLabel.text}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
