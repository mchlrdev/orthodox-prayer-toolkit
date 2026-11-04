import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconArrowBackUp, IconArrowUp, IconCheck, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { groupSkips, hintForChanges, type ChatView, type MemorySuggestion } from "@orthodox-prayer-toolkit/core";
import type { ModelStatus } from "../../electron/modelStore";
import type { Chat, ChatChip, ChatMessage } from "../builtInModel/useChat";
import { changeLines, changedWording } from "../builtInModel/changeLines";
import { formatGb, timeLeft } from "../builtInModel/modelStatusText";
import { getToolkitApi } from "../api";
import { shortcutLabel } from "../appCommands";

type Props = {
  chat: Chat;
  view: ChatView;
  /** What the chat works on: the Import draft's or prayer's title, or the Library. */
  title: string;
  model: ModelStatus | null;
  chips: ChatChip[];
  onRemoveChip: (block: string) => void;
  /** After an instruction was sent (the chips are used up). */
  onSent: () => void;
  /** The number shown next to a change (the source column's number). */
  blockNumber: (block: string) => string;
  speakerName: (id: string) => string;
  /** Library memory: a hint suggested from repeated corrections (null = none). */
  suggestion: MemorySuggestion | null;
  /** Hints the Library memory has (no card for those again). */
  hints: readonly string[];
  /** Remember a suggested hint in the Library memory. */
  onKeepHint: (suggestion: MemorySuggestion) => void;
  /** "No" to a suggestion from repeated corrections (it does not come back). */
  onDismissSuggestion: (key: string) => void;
};

const EXAMPLE: Record<ChatView, string> = {
  import: "For example: “2 and 10 don’t belong” or “#5 is a note”.",
  prayer: "For example: “Give the doxology the speaker Priest”.",
  library: "For example: “In every prayer, Amen is said by the people”.",
};

/** Chip labels in one line: "#3, #7". */
export function chipSummary(chips: readonly ChatChip[]): string {
  return chips.map((c) => c.label).join(", ");
}

/** The model is needed but not on this computer yet (a download, in the desktop app). */
function needsDownload(model: ModelStatus | null): model is ModelStatus {
  return model !== null && model.state !== "installed" && model.state !== "stand-in";
}

/**
 * The assistant mode of the left sidebar: instructions in plain words, run by
 * the Built-in model through the Tool directory. Changes show as a card with
 * Undo; library-wide changes ask first with a confirm card.
 */
export function ChatPane({
  chat,
  view,
  title,
  model,
  chips,
  onRemoveChip,
  onSent,
  blockNumber,
  speakerName,
  suggestion,
  hints,
  onKeepHint,
  onDismissSuggestion,
}: Props) {
  const [text, setText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const send = () => {
    if (chat.running || !text.trim()) return;
    void chat.send(text, view, chips);
    setText("");
    onSent();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-pane">
      <div className="chat-header">
        <span className="chat-title">{title}</span>
      </div>

      <div className="chat-thread" ref={threadRef} aria-live="polite">
        {chat.messages.length === 0 ? <p className="chat-empty">{EXAMPLE[view]}</p> : null}
        {chat.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="chat-user">
              {m.chips.length > 0 ? <span className="chat-chip">{chipSummary(m.chips)}</span> : null}
              <div className="chat-bubble">{m.text}</div>
            </div>
          ) : (
            <AssistantMessage
              key={m.id}
              message={m}
              chat={chat}
              blockNumber={blockNumber}
              speakerName={speakerName}
              hints={hints}
              onKeepHint={onKeepHint}
            />
          ),
        )}
        {suggestion && !hints.includes(suggestion.text) ? (
          <RememberRow
            text={suggestion.text}
            onKeep={() => onKeepHint(suggestion)}
            onDismiss={() => onDismissSuggestion(suggestion.key)}
          />
        ) : null}
      </div>

      <div className="chat-composer-wrap">
        {needsDownload(model) ? (
          <ModelDownloadCard model={model} />
        ) : (
        <div className="chat-composer">
          {chips.length > 0 ? (
            <div className="chat-composer-chips">
              {chips.map((c) => (
                <span key={c.block} className="chat-chip" data-removable="true">
                  {c.label}
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={() => onRemoveChip(c.block)}>
                    <IconX size={10} stroke={1.6} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="chat-composer-row">
            <textarea
              className="chat-input"
              rows={1}
              aria-label="Instruction"
              placeholder="What should change?"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            {chat.running ? (
              <button type="button" className="chat-send" data-stop="true" aria-label="Stop" onClick={chat.stop}>
                <IconPlayerStopFilled size={10} />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send"
                data-ready={text.trim() ? "true" : undefined}
                aria-label="Send"
                disabled={!text.trim()}
                onClick={send}
              >
                <IconArrowUp size={13} stroke={2} />
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/** In place of the input while the model is missing: one button, then progress. */
function ModelDownloadCard({ model }: { model: ModelStatus }) {
  const api = getToolkitApi();
  const size = formatGb(model.model.size);
  const loading = model.state === "downloading" || model.state === "verifying";
  const progress = model.model.size > 0 ? Math.min(1, model.received / model.model.size) : 0;
  const left = model.state === "downloading" ? timeLeft(model) : null;
  return (
    <div className="chat-download">
      <div className="chat-download-text">
        {model.state === "error"
          ? (model.message ?? "The download failed.")
          : loading
            ? model.state === "verifying"
              ? "Checking the download…"
              : `${formatGb(model.received)} of ${size}${left ? ` · ${left}` : ""}`
            : `The assistant runs on this computer. It needs a one-time download (${size}).`}
      </div>
      {loading || model.state === "paused" ? (
        <div className="model-progress" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={progress}>
          <div className="model-progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
      <div className="chat-card-actions">
        {model.state === "downloading" ? (
          <button type="button" className="chat-button" onClick={() => void api.cancelModelDownload()}>
            Pause
          </button>
        ) : model.state === "verifying" ? null : (
          <button type="button" className="chat-button" data-primary="true" onClick={() => void api.downloadModel()}>
            {model.state === "paused" ? "Resume" : model.state === "error" ? "Try again" : "Download"}
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({
  message: m,
  chat,
  blockNumber,
  speakerName,
  hints,
  onKeepHint,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  chat: Chat;
  blockNumber: (block: string) => string;
  speakerName: (id: string) => string;
  hints: readonly string[];
  onKeepHint: (suggestion: MemorySuggestion) => void;
}) {
  if (m.confirm) {
    const items = m.confirm.items ?? [];
    return (
      <div className="chat-assistant">
        {!m.confirm.answered ? <div className="chat-text">This affects more than the open prayer. Please confirm:</div> : null}
        <div className="chat-card" data-tone="confirm">
          <div className="chat-card-head">
            <span className="chat-card-title">{m.confirm.title}</span>
            <span className="chat-card-sub">{m.confirm.message}</span>
          </div>
          {items.length > 0 ? (
            <div className="chat-card-items">
              {items.slice(0, 3).map((item) => (
                <div key={item.label} className="chat-card-item">
                  <span>{item.label}</span>
                  <span className="chat-card-count">{item.count}</span>
                </div>
              ))}
              {items.length > 3 ? (
                <div className="chat-card-item chat-card-more">+ {items.length - 3} more</div>
              ) : null}
            </div>
          ) : null}
          {!m.confirm.answered ? (
            <div className="chat-card-actions">
              <button type="button" className="chat-button" onClick={() => chat.answerConfirm(m.id, false)}>
                Cancel
              </button>
              <button
                type="button"
                className="chat-button"
                data-primary="true"
                onClick={() => chat.answerConfirm(m.id, true)}
              >
                {m.confirm.confirmLabel}
              </button>
            </div>
          ) : null}
        </div>
        {m.pending ? null : <OutcomeText message={m} />}
      </div>
    );
  }

  if (m.pending && !m.text) {
    return (
      <div className="chat-assistant">
        <div className="chat-text" data-muted="true">
          Thinking …
        </div>
      </div>
    );
  }

  if (m.outcome?.kind === "import") {
    const lines = changeLines(m.outcome.changes, speakerName);
    const undoable = chat.canUndo(m.id);
    const hint = m.undone ? null : hintForChanges(m.outcome.before, m.outcome.changes);
    return (
      <div className="chat-assistant">
        <div className="chat-text">
          {m.outcome.understood ? `${m.outcome.understood}.` : lines.length === 0 ? "Nothing changed." : "Done."}
        </div>
        {lines.length > 0 ? (
          <div className="chat-card" data-undone={m.undone ? "true" : undefined}>
            {lines.map((line) => (
              <div key={line.block} className="chat-change">
                <span className="chat-change-n">{blockNumber(line.block)}</span>
                <span>{line.text}</span>
              </div>
            ))}
            {m.outcome.skipped && m.outcome.skipped.length > 0 ? (
              <div className="chat-change" data-muted="true">
                <span className="chat-change-n" />
                <span>
                  Unchanged: {groupSkips(m.outcome.skipped)}
                </span>
              </div>
            ) : null}
            <div className="chat-card-foot">
              <span className="chat-card-sub">
                {m.undone ? "Undone" : changedWording(m.outcome.changes) ? "Text changed" : "Text unchanged"}
              </span>
              {m.undone ? null : undoable ? (
                <button type="button" className="chat-button" data-soft="true" onClick={() => chat.undo(m.id)}>
                  <IconArrowBackUp size={12} stroke={1.6} />
                  Undo
                </button>
              ) : (
                <span className="chat-card-sub">{shortcutLabel("Mod+Z")} to undo</span>
              )}
            </div>
            {hint && (m.hintAnswered || !hints.includes(hint.text)) ? (
              <RememberRow
                text={hint.text}
                kept={m.hintAnswered}
                onKeep={() => {
                  onKeepHint(hint);
                  chat.answerHint(m.id);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="chat-assistant">
      <OutcomeText message={m} />
    </div>
  );
}

/** A rule for the Library memory, kept with one click (ignoring it is "no"). */
function RememberRow({
  text,
  kept = false,
  onKeep,
  onDismiss,
}: {
  text: string;
  kept?: boolean;
  onKeep: () => void;
  /** Never suggest it again (suggestions from repeated corrections). */
  onDismiss?: () => void;
}) {
  return (
    <div className="chat-remember">
      <div className="chat-remember-text">“{text}”</div>
      <div className="chat-remember-actions">
        {kept ? (
          <span className="chat-card-sub">
            <IconCheck size={12} stroke={2} /> Remembered for next time
          </span>
        ) : (
          <button type="button" className="chat-button" data-soft="true" onClick={onKeep}>
            Remember for next time
          </button>
        )}
        {onDismiss && !kept ? (
          <button type="button" className="chat-remember-dismiss" aria-label="Don’t suggest again" onClick={onDismiss}>
            <IconX size={11} stroke={1.8} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function OutcomeText({ message: m }: { message: Extract<ChatMessage, { role: "assistant" }> }) {
  const text = m.outcome?.kind === "prayers" ? m.outcome.summary : m.text;
  if (!text) return null;
  return <div className="chat-text">{text}</div>;
}
