import { useState, type KeyboardEvent } from "react";
import { Alert, List, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import {
  answerLabel,
  lookSummary,
  type LibraryMemory,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  memory: LibraryMemory;
  errors: readonly ValidationError[];
  onAddHint: (text: string) => void;
  /** Remove a hint or a learned correction. */
  onRemove: (id: string) => void;
  onReset: () => void;
};

/** Corrections shown before "Show all". */
const FIRST = 5;

/**
 * Library settings → Memory (`memory.json`): plain-text hints and the
 * corrections learned from saved imports, newest first. Read-only while the
 * file has errors (rewriting would lose the entries the app cannot read).
 */
export function MemoryPanel({ memory, errors, onAddHint, onRemove, onReset }: Props) {
  const locked = errors.length > 0;
  const [adding, setAdding] = useState(false);
  const [hint, setHint] = useState("");
  const [all, setAll] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const examples = [...memory.examples].reverse();
  const shown = all ? examples : examples.slice(0, FIRST);
  const empty = memory.hints.length === 0 && memory.examples.length === 0;

  const add = () => {
    if (hint.trim()) onAddHint(hint);
    setHint("");
    setAdding(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setHint("");
      setAdding(false);
    }
  };

  return (
    <Stack gap={20} className="memory-panel">
      {locked ? (
        <Alert color="accent" variant="light" icon={<IconAlertTriangle size={16} />} title="memory.json has errors">
          <Stack gap={4}>
            <Text size="xs">
              The memory is read-only until the file is fixed (saving now would drop the entries the app cannot
              read). What could be read is still used.
            </Text>
            <List size="xs" spacing={2}>
              {errors.slice(0, 8).map((e) => (
                <List.Item key={`${e.path}:${e.message}`}>
                  <Text size="xs" ff="monospace" span>
                    {e.path}
                  </Text>{" "}
                  {e.message}
                </List.Item>
              ))}
            </List>
          </Stack>
        </Alert>
      ) : null}

      <section className="memory-section">
        <div className="memory-section-head">
          <span className="memory-section-title">Hints</span>
          {!locked && !adding ? (
            <button type="button" className="memory-link" onClick={() => setAdding(true)}>
              + Hint
            </button>
          ) : null}
        </div>
        <p className="memory-note">
          Rules in plain words. The Built-in model and agents read them before every decision. They live in the
          Library and travel with it.
        </p>
        {memory.hints.length > 0 || adding ? (
          <div className="memory-list">
            {memory.hints.map((h) => (
              <div key={h.id} className="memory-row">
                <span className="memory-row-text">{h.text}</span>
                <span className="memory-row-meta">{h.from === "suggestion" ? "from a suggestion" : "by you"}</span>
                <RemoveButton label="Remove hint" disabled={locked} onClick={() => onRemove(h.id)} />
              </div>
            ))}
            {adding ? (
              <div className="memory-row">
                <input
                  className="memory-input"
                  autoFocus
                  placeholder="e.g. Doxologies are always verses."
                  value={hint}
                  onChange={(e) => setHint(e.currentTarget.value)}
                  onKeyDown={onKeyDown}
                  onBlur={add}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="memory-section">
        <div className="memory-section-head">
          <span className="memory-section-title">Learned corrections</span>
          {examples.length > 0 ? <span className="memory-count">{examples.length}</span> : null}
        </div>
        {examples.length === 0 ? (
          <p className="memory-note">
            None yet. When you correct the Built-in model in an import and save it, the correction is kept here and
            decides the same way next time.
          </p>
        ) : (
          <div className="memory-list">
            {shown.map((e) => {
              const look = lookSummary(e.look);
              return (
                <div key={e.id} className="memory-row">
                  <span className="memory-row-main">
                    <span className="memory-row-text" data-italic={e.look.italic === true || e.look.style === "italic" ? "true" : undefined}>
                      “{e.text}”
                    </span>
                    <span className="memory-row-meta">{[e.origin || "Unknown source", look].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="memory-answer">
                    <span className="memory-answer-wrong">{answerLabel(e.wrong)}</span>
                    <span className="memory-answer-arrow">→</span>
                    <span className="memory-answer-right">{answerLabel(e.right)}</span>
                  </span>
                  <RemoveButton label="Remove correction" disabled={locked} onClick={() => onRemove(e.id)} />
                </div>
              );
            })}
            {examples.length > FIRST ? (
              <button type="button" className="memory-row memory-more" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${examples.length}`}
              </button>
            ) : null}
          </div>
        )}
      </section>

      <div className="memory-foot">
        <span>Stored in .orthodox-prayer-toolkit/memory.json</span>
        <button
          type="button"
          className="memory-reset"
          disabled={locked || empty}
          onClick={() => setConfirmReset(true)}
        >
          Reset memory …
        </button>
      </div>

      <ConfirmDialog
        opened={confirmReset}
        onClose={() => setConfirmReset(false)}
        zIndex={400}
        title="Reset memory?"
        message={`Remove ${count(memory.hints.length, "hint")} and ${count(memory.examples.length, "learned correction")} from this Library? Prayers are not changed.`}
        confirmLabel="Reset"
        onConfirm={() => {
          onReset();
          setConfirmReset(false);
        }}
      />
    </Stack>
  );
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="memory-remove" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <IconX size={13} stroke={1.6} />
    </button>
  );
}
