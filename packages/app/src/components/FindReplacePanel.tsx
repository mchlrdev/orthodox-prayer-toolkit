import {
  ActionIcon,
  Button,
  Group,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconLetterCase,
  IconReplace,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type { RefObject } from "react";
import type { FindReplaceState } from "../findReplace/state";

type Props = {
  state: FindReplaceState;
  matchCount: number;
  currentIndex: number;
  findInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onReplaceWithChange: (value: string) => void;
  onToggleMatchCase: () => void;
  onToggleWholeWord: () => void;
  onToggleReplaceExpanded: () => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onReplaceCurrent: () => void;
  onReplaceAll: () => void;
};

function counterLabel(currentIndex: number, matchCount: number): string {
  if (matchCount === 0) return "0 / 0";
  return `${currentIndex + 1} / ${matchCount}`;
}

export function FindReplacePanel({
  state,
  matchCount,
  currentIndex,
  findInputRef,
  replaceInputRef,
  onQueryChange,
  onReplaceWithChange,
  onToggleMatchCase,
  onToggleWholeWord,
  onToggleReplaceExpanded,
  onClose,
  onNext,
  onPrev,
  onReplaceCurrent,
  onReplaceAll,
}: Props) {
  const noMatches = state.query.length > 0 && matchCount === 0;

  return (
    <div className="find-replace-panel" role="search" aria-label="Find and replace">
      <div className="find-replace-row">
        <TextInput
          ref={findInputRef}
          className="find-replace-input"
          size="xs"
          placeholder="Find"
          value={state.query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          leftSection={<IconSearch size={14} stroke={1.8} />}
          aria-label="Find"
        />

        <div className="find-replace-actions">
          <Group gap={4} wrap="nowrap" className="find-replace-toggles">
            <Tooltip label="Match case" withArrow openDelay={400}>
              <ActionIcon
                size="sm"
                variant={state.matchCase ? "light" : "subtle"}
                color={state.matchCase ? "accent" : "gray"}
                aria-label="Match case"
                aria-pressed={state.matchCase}
                onClick={onToggleMatchCase}
              >
                <IconLetterCase size={15} stroke={1.8} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Whole word" withArrow openDelay={400}>
              <ActionIcon
                size="sm"
                variant={state.wholeWord ? "light" : "subtle"}
                color={state.wholeWord ? "accent" : "gray"}
                aria-label="Whole word"
                aria-pressed={state.wholeWord}
                onClick={onToggleWholeWord}
              >
                <span className="find-replace-toggle-label" aria-hidden="true">
                  W
                </span>
              </ActionIcon>
            </Tooltip>
          </Group>

          <Text
            className="find-replace-counter"
            size="xs"
            c={noMatches ? "dimmed" : undefined}
            aria-live="polite"
            title={noMatches ? "No matches" : undefined}
          >
            {counterLabel(currentIndex, matchCount)}
          </Text>

          <Group gap={2} wrap="nowrap" className="find-replace-nav">
            <Tooltip label="Previous (Shift+Enter)" withArrow openDelay={400}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Previous match"
                onClick={onPrev}
                disabled={matchCount === 0}
              >
                <IconChevronUp size={16} stroke={2} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Next (Enter)" withArrow openDelay={400}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="Next match"
                onClick={onNext}
                disabled={matchCount === 0}
              >
                <IconChevronDown size={16} stroke={2} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Tooltip
            label={state.replaceExpanded ? "Hide replace" : "Replace (⌥⌘F)"}
            withArrow
            openDelay={400}
          >
            <ActionIcon
              size="sm"
              variant={state.replaceExpanded ? "light" : "subtle"}
              color={state.replaceExpanded ? "accent" : "gray"}
              aria-label="Toggle replace"
              aria-expanded={state.replaceExpanded}
              onClick={onToggleReplaceExpanded}
            >
              <IconReplace size={15} stroke={1.8} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label="Close (Esc)" withArrow openDelay={400}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              aria-label="Close find"
              onClick={onClose}
            >
              <IconX size={16} stroke={2} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>

      {state.replaceExpanded ? (
        <div className="find-replace-row find-replace-row-replace">
          <TextInput
            ref={replaceInputRef}
            className="find-replace-input"
            size="xs"
            placeholder="Replace"
            value={state.replaceWith}
            onChange={(event) => onReplaceWithChange(event.currentTarget.value)}
            leftSection={<IconReplace size={14} stroke={1.8} />}
            aria-label="Replace with"
          />
          <Group gap="xs" wrap="nowrap" className="find-replace-actions">
            <Button
              size="xs"
              variant="default"
              onClick={onReplaceCurrent}
              disabled={matchCount === 0}
            >
              Replace
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={onReplaceAll}
              disabled={matchCount === 0}
            >
              Replace all
            </Button>
          </Group>
        </div>
      ) : null}
    </div>
  );
}
