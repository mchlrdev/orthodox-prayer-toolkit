import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Group, Menu, Popover, UnstyledButton } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";

/** Block right-click Menu. Kind / Speaker pick-one popovers use the same width. */
export const CONTEXT_MENU_WIDTH = 220;
/** Kind ▸ / Speaker ▸ flyout only — do not widen the pickers or the main menu to this. */
export const CONTEXT_SUBMENU_WIDTH = 240;

export type ContextMenuAction = {
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  /** Extra content on the right (before the shortcut), e.g. a muted id or a check. */
  right?: ReactNode;
  color?: string;
  disabled?: boolean;
  onClick: () => void;
};

export type ContextMenuItem =
  | ContextMenuAction
  | {
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      /** Nested items (one level), opened on hover / ArrowRight. */
      submenu: ContextMenuItem[];
    }
  | { divider: true }
  | { section: ReactNode };

type OpenMenu = { x: number; y: number; items: ContextMenuItem[] };

function Shortcut({ value }: { value?: string }) {
  return value ? <span className="context-menu-shortcut">{value}</span> : null;
}

type SubmenuEntry = Extract<ContextMenuItem, { submenu: ContextMenuItem[] }>;

const OPEN_DELAY = 60;
const CLOSE_DELAY = 180;

/**
 * Nested menu (Mantine v7 has no public Menu.Sub).
 *
 * The parent row is a plain item of the parent Menu (parent hover state, so
 * it highlights like its siblings); the submenu is a Popover with its own
 * rows and its own highlight state. Nesting a second Mantine Menu instead
 * makes both Menus share one hovered index and highlight two rows at once.
 *
 * - Hover opens after a short delay; leaving trigger and submenu closes it.
 * - While open the parent row keeps the highlight (`data-sub-open`) unless
 *   another parent row is hovered (CSS), so one row per level looks active.
 * - Mouse-open highlights nothing in the submenu; ArrowRight / Enter / Space
 *   opens it and focuses its first row. ArrowLeft / Escape go back.
 */
function SubmenuItem({
  item,
  closeAll,
}: {
  item: SubmenuEntry;
  closeAll: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [hovered, setHovered] = useState(-1);
  const targetRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const close = () => {
    clearTimer();
    setOpened(false);
    setHovered(-1);
  };
  const openSoon = () => {
    clearTimer();
    if (!opened) timer.current = window.setTimeout(() => setOpened(true), OPEN_DELAY);
  };
  const closeSoon = () => {
    clearTimer();
    timer.current = window.setTimeout(close, CLOSE_DELAY);
  };

  const rows = () => [
    ...(dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-submenu-row]:not(:disabled)",
    ) ?? []),
  ];
  const focusRow = (index: number) => {
    const all = rows();
    const row = all[(index + all.length) % all.length];
    if (!row) return;
    row.focus();
    setHovered(Number(row.dataset.submenuRow));
  };
  const openWithKeyboard = () => {
    clearTimer();
    setOpened(true);
    // The dropdown mounts on the next frame.
    requestAnimationFrame(() => focusRow(0));
  };
  const back = () => {
    close();
    targetRef.current?.focus();
  };

  let rowIndex = 0;
  const content = item.submenu.map((sub, i) => {
    if ("divider" in sub) return <Menu.Divider key={`d${i}`} />;
    if ("section" in sub) {
      return <Menu.Label key={`s${i}`}>{sub.section}</Menu.Label>;
    }
    // One level deep is enough for the editor; deeper entries render flat.
    if ("submenu" in sub) return null;
    const index = rowIndex++;
    return (
      <UnstyledButton
        key={`i${i}`}
        className={`${Menu.classes.item} mantine-Menu-item`}
        data-submenu-row={index}
        data-sub-hovered={hovered === index ? true : undefined}
        data-disabled={sub.disabled || undefined}
        disabled={sub.disabled}
        role="menuitem"
        tabIndex={-1}
        style={
          sub.color
            ? ({ "--menu-item-color": `var(--mantine-color-${sub.color}-6)` } as CSSProperties)
            : undefined
        }
        onMouseEnter={() => setHovered(index)}
        onMouseLeave={() => setHovered(-1)}
        onFocus={() => setHovered(index)}
        onClick={() => {
          sub.onClick();
          closeAll();
        }}
      >
        {sub.icon ? (
          <div className={Menu.classes.itemSection} data-position="left">
            {sub.icon}
          </div>
        ) : null}
        <div className={Menu.classes.itemLabel}>{sub.label}</div>
        {sub.right || sub.shortcut ? (
          <div className={Menu.classes.itemSection} data-position="right">
            <Group gap={6} wrap="nowrap">
              {sub.right}
              <Shortcut value={sub.shortcut} />
            </Group>
          </div>
        ) : null}
      </UnstyledButton>
    );
  });

  return (
    <Popover
      opened={opened}
      position="right-start"
      offset={4}
      shadow="md"
      width={CONTEXT_SUBMENU_WIDTH}
      withinPortal={false}
      trapFocus={false}
      returnFocus={false}
      closeOnEscape={false}
      closeOnClickOutside={false}
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        <Menu.Item
          ref={targetRef}
          closeMenuOnClick={false}
          data-sub-open={opened || undefined}
          aria-haspopup="menu"
          aria-expanded={opened}
          leftSection={item.icon}
          rightSection={
            <Group gap={6} wrap="nowrap">
              <Shortcut value={item.shortcut} />
              <IconChevronRight size={14} />
            </Group>
          }
          onMouseEnter={openSoon}
          onMouseLeave={() => {
            if (opened) closeSoon();
            else clearTimer();
          }}
          onClick={() => {
            clearTimer();
            setOpened(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              openWithKeyboard();
            }
          }}
        >
          {item.label}
        </Menu.Item>
      </Popover.Target>
      <Popover.Dropdown
        ref={dropdownRef}
        className={Menu.classes.dropdown}
        role="menu"
        onMouseEnter={clearTimer}
        onMouseLeave={() => {
          setHovered(-1);
          closeSoon();
        }}
        onKeyDown={(e) => {
          // Keep keys out of the parent Menu (its own arrow / Escape handling).
          const all = rows();
          const current = all.findIndex((r) => r === document.activeElement);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            focusRow(current + (e.key === "ArrowDown" ? 1 : -1));
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            e.stopPropagation();
            focusRow(e.key === "Home" ? 0 : all.length - 1);
          } else if (e.key === "ArrowLeft" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            back();
          }
        }}
      >
        {content}
      </Popover.Dropdown>
    </Popover>
  );
}

function renderItems(items: ContextMenuItem[], closeAll: () => void): ReactNode[] {
  return items.map((item, i) => {
    if ("divider" in item) return <Menu.Divider key={`d${i}`} />;
    if ("section" in item) {
      return <Menu.Label key={`s${i}`}>{item.section}</Menu.Label>;
    }
    if ("submenu" in item) {
      return <SubmenuItem key={`sub${i}`} item={item} closeAll={closeAll} />;
    }
    const right =
      item.right || item.shortcut ? (
        <Group gap={6} wrap="nowrap">
          {item.right}
          <Shortcut value={item.shortcut} />
        </Group>
      ) : undefined;
    return (
      <Menu.Item
        key={`i${i}`}
        leftSection={item.icon}
        rightSection={right}
        color={item.color}
        disabled={item.disabled}
        onClick={() => {
          item.onClick();
          // Items of a nested menu close the whole context menu.
          closeAll();
        }}
      >
        {item.label}
      </Menu.Item>
    );
  });
}

/**
 * Right-click menu at the cursor. `open` prevents the native menu; render
 * `menu` once somewhere in the component.
 */
export function useContextMenu() {
  const [state, setState] = useState<OpenMenu | null>(null);

  const open = useCallback(
    (event: MouseEvent, items: ContextMenuItem[]) => {
      if (items.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setState({ x: event.clientX, y: event.clientY, items });
    },
    [],
  );

  const close = useCallback(() => setState(null), []);

  const menu = state ? (
    <Menu
      opened
      onChange={(o) => {
        if (!o) close();
      }}
      position="bottom-start"
      offset={2}
      shadow="md"
      width={CONTEXT_MENU_WIDTH}
      withinPortal
      returnFocus={false}
      // Escape is handled on the dropdown (bubble phase), so an open submenu
      // can take it first and only step back one level.
      closeOnEscape={false}
    >
      <Menu.Target>
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: state.x,
            top: state.y,
            width: 0,
            height: 0,
          }}
        />
      </Menu.Target>
      <Menu.Dropdown
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        {renderItems(state.items, close)}
      </Menu.Dropdown>
    </Menu>
  ) : null;

  return { open, close, menu };
}
