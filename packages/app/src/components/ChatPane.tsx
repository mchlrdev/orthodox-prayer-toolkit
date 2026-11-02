import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconArrowBackUp, IconArrowUp, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { hintForChanges, type ChatView, type MemorySuggestion } from "@orthodox-prayer-toolkit/core";
import type { ModelStatus } from "../../electron/modelStore";
import type { Chat, ChatChip, ChatMessage } from "../builtInModel/useChat";
import { changeLines, changedWording } from "../builtInModel/changeLines";

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
  /** Section or block number shown in the change card. */
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

const PLACEHOLDER: Record<ChatView, string> = {
  import: "Instruction for the draft …",
  prayer: "Instruction for this prayer …",
  library: "Instruction for the library …",
};

const HINT: Record<ChatView, string> = {
  import: "Only this draft",
  prayer: "Library-wide asks first",
  library: "Library-wide asks first",
};

/** "Section 3, 7" for chips that share their first word. */
export function chipSummary(chips: readonly ChatChip[]): string {
  const words = chips.map((c) => c.label.split(" "));
  const head = words[0]?.[0];
  if (head && words.every((w) => w[0] === head && w.length === 2)) {
    return `${head} ${words.map((w) => w[1]).join(", ")}`;
  }
  return chips.map((c) => c.label).join(", ");
}

function modelLabel(model: ModelStatus | null): { text: string; tone: "ok" | "muted" | "warning" } {
  if (!model) return { text: "Model …", tone: "muted" };
  if (model.state === "installed") return { text: "Model local", tone: "ok" };
  if (model.state === "stand-in") return { text: "Stand-in model", tone: "muted" };
  if (model.state === "downloading" || model.state === "verifying") return { text: "Model downloading", tone: "muted" };
  return { text: "Model not installed", tone: "warning" };
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
  const status = modelLabel(model);

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
        <span className="chat-model" data-tone={status.tone}>
          <span className="chat-model-dot" />
          {status.text}
        </span>
      </div>

      <div className="chat-thread" ref={threadRef}>
        {chat.messages.length === 0 ? (
          <p className="chat-empty">
            {view === "import"
              ? "Tell the assistant what to change, e.g. “The source line at the end does not belong.”"
              : "Tell the assistant what to change, e.g. “Give „Glory to the Father …“ the speaker Priest.”"}
          </p>
        ) : null}
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
          <RememberCard
            text={suggestion.text}
            onKeep={() => onKeepHint(suggestion)}
            onNo={() => onDismissSuggestion(suggestion.key)}
          />
        ) : null}
      </div>

      <div className="chat-composer-wrap">
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
          <textarea
            className="chat-input"
            rows={1}
            placeholder={PLACEHOLDER[view]}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <div className="chat-composer-foot">
            <span className="chat-hint">{HINT[view]}</span>
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
    const hint = m.undone || m.hintAnswered ? null : hintForChanges(m.outcome.before, m.outcome.changes);
    return (
      <div className="chat-assistant">
        <div className="chat-text">
          {lines.length === 0
            ? "Nothing needed changing."
            : changedWording(m.outcome.changes)
              ? "Done."
              : "Done. The text itself stays unchanged."}
        </div>
        {lines.length > 0 ? (
          <div className="chat-card" data-undone={m.undone ? "true" : undefined}>
            {lines.map((line) => (
              <div key={line.block} className="chat-change">
                <span className="chat-change-n">{blockNumber(line.block)}</span>
                <span>{line.text}</span>
              </div>
            ))}
            <div className="chat-card-foot">
              <span className="chat-card-sub">
                {m.undone ? "Undone" : `${lines.length} ${lines.length === 1 ? "change" : "changes"}`}
              </span>
              {m.undone ? null : (
                <button
                  type="button"
                  className="chat-button"
                  data-soft="true"
                  disabled={!undoable}
                  title={undoable ? undefined : "Later edits came after this answer; use Undo in the toolbar."}
                  onClick={() => chat.undo(m.id)}
                >
                  <IconArrowBackUp size={12} stroke={1.6} />
                  Undo
                </button>
              )}
            </div>
          </div>
        ) : null}
        {hint && !hints.includes(hint.text) ? (
          <RememberCard
            text={hint.text}
            onKeep={() => {
              onKeepHint(hint);
              chat.answerHint(m.id);
            }}
            onNo={() => chat.answerHint(m.id)}
          />
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

/** "For future imports, remember? …": a hint for the Library memory. */
function RememberCard({ text, onKeep, onNo }: { text: string; onKeep: () => void; onNo: () => void }) {
  return (
    <div className="chat-remember">
      <div className="chat-remember-text">Remember for future imports? “{text}”</div>
      <div className="chat-remember-actions">
        <button type="button" className="chat-button" data-primary="true" onClick={onKeep}>
          Remember
        </button>
        <button type="button" className="chat-button" onClick={onNo}>
          No
        </button>
      </div>
    </div>
  );
}

function OutcomeText({ message: m }: { message: Extract<ChatMessage, { role: "assistant" }> }) {
  const text = m.outcome?.kind === "prayers" ? m.outcome.summary : m.text;
  if (!text) return null;
  return <div className="chat-text">{text}</div>;
}
