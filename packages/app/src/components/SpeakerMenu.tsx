import { forwardRef, useCallback, type ReactElement } from "react";
import { Popover, UnstyledButton } from "@mantine/core";
import { IconCheck, IconUser } from "@tabler/icons-react";
import {
  listSpeakers,
  resolveSpeakerLabel,
  speakerChipLabel,
  type Prayer,
  type VariantRef,
} from "@orthodox-prayer-toolkit/core";
import type { ContextMenuItem } from "./ContextMenu";
import { kindTriggerStyle } from "./KindSelect";
import {
  OPTION_DROPDOWN_PADDING,
  OPTION_POPOVER_PROPS,
  OptionDivider,
  OptionList,
  OptionRow,
  focusOptionRow,
} from "./OptionList";

export type SpeakerOption = {
  id: string;
  /** Chip text for the first visible column. */
  chip: string;
  /** Printed name for the first visible column. */
  name: string;
};

/**
 * Every speaker the editor offers (all presets, then custom ones of this
 * prayer — {@link listSpeakers}), labelled for the first visible column.
 */
export function speakerOptions(
  prayer: Prayer,
  ref: VariantRef | undefined,
): SpeakerOption[] {
  const at = ref ?? prayer.variants[0] ?? { lang: "", variant: "" };
  return listSpeakers(prayer).map((s) => ({
    id: s.id,
    chip: speakerChipLabel(prayer, at, s.id),
    name: resolveSpeakerLabel(prayer, at, s.id, "name"),
  }));
}

function ChipSlot({ text }: { text?: string }) {
  return (
    <span className="speaker-menu-slot">
      {text ? <span className="speaker-chip-pill">{text}</span> : null}
    </span>
  );
}

type MenuActions = {
  value: string | undefined;
  options: SpeakerOption[];
  onSelect: (id: string | null) => void;
  onMore: () => void;
};

/** Same entries as the dropdown, for the block right-click "Speaker ▸" submenu. */
export function speakerContextItems({
  value,
  options,
  onSelect,
  onMore,
}: MenuActions): ContextMenuItem[] {
  const check = (on: boolean) => (on ? <IconCheck size={14} /> : undefined);
  const items: ContextMenuItem[] = [
    {
      label: "No speaker",
      icon: <ChipSlot />,
      right: check(value === undefined),
      onClick: () => onSelect(null),
    },
  ];
  if (options.length > 0) {
    items.push({ divider: true });
    for (const o of options) {
      items.push({
        label: o.name,
        icon: <ChipSlot text={o.chip} />,
        right: check(value === o.id),
        onClick: () => onSelect(o.id),
      });
    }
  }
  items.push(
    { divider: true },
    {
      label: "More speakers…",
      icon: <ChipSlot />,
      onClick: onMore,
    },
  );
  return items;
}

type SpeakerMenuProps = MenuActions & {
  opened: boolean;
  onClose: () => void;
  /** The chip or chrome trigger the dropdown hangs from. */
  children: ReactElement;
};

/**
 * Speaker dropdown: No speaker · every speaker · More speakers…. Same
 * Popover and rows as the Kind popover (OptionList).
 */
export function SpeakerMenu({
  opened,
  onClose,
  children,
  value,
  options,
  onSelect,
  onMore,
}: SpeakerMenuProps) {
  // Keyboard-ready on open (Mod+Shift+P): focus the checked row.
  const dropdownRef = useCallback((node: HTMLDivElement | null) => {
    if (node) requestAnimationFrame(() => focusOptionRow(node));
  }, []);
  // Rows act, then close (as a Menu item would).
  const pick = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <Popover
      opened={opened}
      onChange={(o) => {
        if (!o) onClose();
      }}
      {...OPTION_POPOVER_PROPS}
      returnFocus={false}
    >
      <Popover.Target>{children}</Popover.Target>
      <Popover.Dropdown
        ref={dropdownRef}
        p={OPTION_DROPDOWN_PADDING}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keep Enter / Escape from reaching the editor underneath.
          if (e.key === "Enter" || e.key === "Escape") e.stopPropagation();
        }}
      >
        <OptionList>
          <OptionRow
            leading={<ChipSlot />}
            active={value === undefined}
            onClick={() => pick(() => onSelect(null))}
          >
            No speaker
          </OptionRow>
          {options.length > 0 ? <OptionDivider /> : null}
          {options.map((o) => (
            <OptionRow
              key={o.id}
              leading={<ChipSlot text={o.chip} />}
              active={value === o.id}
              onClick={() => pick(() => onSelect(o.id))}
            >
              {o.name}
            </OptionRow>
          ))}
          <OptionDivider />
          <OptionRow leading={<ChipSlot />} onClick={() => pick(onMore)}>
            More speakers…
          </OptionRow>
        </OptionList>
      </Popover.Dropdown>
    </Popover>
  );
}

type TriggerProps = {
  /** Full speaker name when set; null shows the unset user-icon. */
  name: string | null;
  onClick: () => void;
};

/** Block chrome control left of the Kind chip. */
export const SpeakerTrigger = forwardRef<HTMLButtonElement, TriggerProps>(
  function SpeakerTrigger({ name, onClick, ...rest }, ref) {
    if (name) {
      return (
        <UnstyledButton
          {...rest}
          ref={ref}
          className="option-row"
          style={kindTriggerStyle(true)}
          aria-label={`Speaker: ${name}`}
          title={`Speaker: ${name}`}
          onClick={onClick}
        >
          {name}
        </UnstyledButton>
      );
    }
    return (
      <UnstyledButton
        {...rest}
        ref={ref}
        className="speaker-trigger"
        aria-label="Set speaker"
        title="Set speaker"
        onClick={onClick}
      >
        <IconUser size={13} stroke={1.9} />
      </UnstyledButton>
    );
  },
);

type ChipProps = {
  chip: string;
  name: string;
  /** Kind font size, so the chip box is exactly one text line tall. */
  fontSize?: string | number;
  /** Text direction of the cell: the chip floats to its inline start. */
  dir?: "ltr" | "rtl";
  onClick: () => void;
};

/**
 * Speaker chip floated before the block text (first visible column). A
 * sibling of the contenteditable — never part of its DOM — so caret offsets,
 * serialize, split / join and the accent initial are untouched.
 */
export const SpeakerChip = forwardRef<HTMLButtonElement, ChipProps>(
  function SpeakerChip({ chip, name, fontSize, dir, onClick, ...rest }, ref) {
    return (
      <button
        {...rest}
        ref={ref}
        type="button"
        className="speaker-chip"
        data-dir={dir === "rtl" ? "rtl" : undefined}
        aria-label={`Speaker: ${name}`}
        title={name}
        style={{ fontSize }}
        onMouseDown={(e) => {
          // Keep the click off the block's "focus the text" handler.
          e.stopPropagation();
        }}
        onClick={onClick}
      >
        <span className="speaker-chip-pill">{chip}</span>
      </button>
    );
  },
);
