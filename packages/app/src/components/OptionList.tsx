import type { KeyboardEvent, ReactNode } from "react";
import { Menu, Stack, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { CONTEXT_MENU_WIDTH } from "./ContextMenu";

/**
 * Shared look of the small pick-one popovers (Kind, Speaker): one Popover
 * with these props, an {@link OptionList} of {@link OptionRow}s and
 * {@link OptionDivider}s. Keep both pickers on these so they cannot drift.
 * Density matches the block right-click Menu / its Kind ▸ Speaker ▸ items.
 */
export const OPTION_POPOVER_PROPS = {
  position: "bottom-start",
  width: CONTEXT_MENU_WIDTH,
  withinPortal: true,
} as const;

/** Same padding as Mantine Menu.Dropdown (4px). */
export const OPTION_DROPDOWN_PADDING = 4;

const ROW_SELECTOR = "button.option-row:not(:disabled)";

/** Arrow / Home / End move focus between the rows of one list. */
export function moveOptionFocus(
  container: HTMLElement,
  key: string,
): boolean {
  const rows = [...container.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  if (rows.length === 0) return false;
  const current = rows.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % rows.length;
  else if (key === "ArrowUp")
    next = current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length;
  else if (key === "Home") next = 0;
  else if (key === "End") next = rows.length - 1;
  else return false;
  rows[next]?.focus();
  return true;
}

/** Focus the active row (or the first one) of a list, e.g. right after opening. */
export function focusOptionRow(container: HTMLElement | null): void {
  if (!container) return;
  const target =
    container.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-active="true"]`) ??
    container.querySelector<HTMLElement>(ROW_SELECTOR);
  target?.focus({ preventScroll: true });
}

export function OptionList({ children }: { children: ReactNode }) {
  return (
    <Stack
      gap={0}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (moveOptionFocus(e.currentTarget, e.key)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
    </Stack>
  );
}

type RowProps = {
  active?: boolean;
  /** Fixed-width leading slot (e.g. a speaker chip); omit for none. */
  leading?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  "aria-label"?: string;
};

/** One pickable row: [leading] label · check when active. Same classes as Menu.Item. */
export function OptionRow({
  active = false,
  leading,
  children,
  onClick,
  ...rest
}: RowProps) {
  return (
    <UnstyledButton
      {...rest}
      className={`option-row ${Menu.classes.item} mantine-Menu-item`}
      data-active={active}
      onClick={onClick}
    >
      {leading !== undefined ? (
        <div className={`${Menu.classes.itemSection} option-row-leading`} data-position="left">
          {leading}
        </div>
      ) : null}
      <div className={`${Menu.classes.itemLabel} option-row-label`}>{children}</div>
      {active ? (
        <div className={Menu.classes.itemSection} data-position="right">
          <IconCheck size={14} />
        </div>
      ) : null}
    </UnstyledButton>
  );
}

export function OptionDivider() {
  return <div className="option-divider" role="separator" />;
}
