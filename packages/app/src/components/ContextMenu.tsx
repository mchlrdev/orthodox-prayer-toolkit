import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { Menu } from "@mantine/core";

export type ContextMenuItem =
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      color?: string;
      disabled?: boolean;
      onClick: () => void;
    }
  | { divider: true }
  | { section: string };

type OpenMenu = { x: number; y: number; items: ContextMenuItem[] };

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
      width={220}
      withinPortal
      returnFocus={false}
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
      <Menu.Dropdown onContextMenu={(e) => e.preventDefault()}>
        {state.items.map((item, i) => {
          if ("divider" in item) return <Menu.Divider key={`d${i}`} />;
          if ("section" in item) {
            return <Menu.Label key={`s${i}`}>{item.section}</Menu.Label>;
          }
          return (
            <Menu.Item
              key={`${item.label}${i}`}
              leftSection={item.icon}
              rightSection={
                item.shortcut ? (
                  <span className="context-menu-shortcut">{item.shortcut}</span>
                ) : undefined
              }
              color={item.color}
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {item.label}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  ) : null;

  return { open, close, menu };
}
