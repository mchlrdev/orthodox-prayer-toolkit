import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatTurn, ChatView } from "@orthodox-prayer-toolkit/core";
import type { ConfirmRequest, ToolHost } from "../agentTools/toolDirectory";
import type { useImportDraft } from "../importDraft/useImportDraft";
import { runInstruction, type ChatOutcome } from "./chatInstruction";
import { availableRuntime } from "./useFirstDraft";

export type ChatChip = { block: string; label: string };

export type ChatMessage =
  | { id: number; role: "user"; text: string; chips: ChatChip[] }
  | {
      id: number;
      role: "assistant";
      /** Streaming or final text. */
      text: string;
      pending?: boolean;
      outcome?: ChatOutcome;
      /** "Answer n" for answers that changed the Import draft. */
      answer?: number;
      undone?: boolean;
      /** The "remember for future imports?" card was answered. */
      hintAnswered?: boolean;
      /** A Tool waiting for the user's yes. */
      confirm?: ConfirmRequest & { resolve: (ok: boolean) => void; answered?: boolean };
    };

export type Chat = {
  messages: ChatMessage[];
  running: boolean;
  send: (text: string, view: ChatView, chips: ChatChip[]) => Promise<void>;
  stop: () => void;
  undo: (id: number) => void;
  canUndo: (id: number) => boolean;
  answerConfirm: (id: number, ok: boolean) => void;
  /** Close an answer's "remember?" card (Remember or No). */
  answerHint: (id: number) => void;
  /** The answer whose changes are marked in the import view (null = none). */
  highlighted: number | null;
  hideHighlight: () => void;
};

/**
 * The Chat pane's conversation: each instruction runs on the Built-in model
 * (or the stand-in) through the Tool directory. Import changes come from the
 * model (origin "model", one undo step); confirmations show as cards.
 */
export function useChat(host: ToolHost, importDraft: ReturnType<typeof useImportDraft>): Chat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const answers = useRef(0);
  /** The conversation so far, for follow-ups ("entferne das", "nein, Leser"). */
  const turns = useRef<ChatTurn[]>([]);
  const hostRef = useRef(host);
  hostRef.current = host;
  const importRef = useRef(importDraft);
  importRef.current = importDraft;

  // A new or discarded draft starts a new conversation: old answers would
  // mark and undo blocks of a draft that is gone (block ids repeat).
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setHighlighted(null);
    answers.current = 0;
    turns.current = [];
  }, [importDraft.session]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const patch = (id: number, change: Partial<Extract<ChatMessage, { role: "assistant" }>>) =>
    setMessages((list) => list.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...change } : m)));

  const send = useCallback(async (text: string, view: ChatView, chips: ChatChip[]) => {
    const instruction = text.trim();
    if (!instruction) return;
    const userId = nextId.current++;
    const replyId = nextId.current++;
    setMessages((list) => [
      ...list,
      { id: userId, role: "user", text: instruction, chips },
      { id: replyId, role: "assistant", text: "", pending: true },
    ]);
    const runtime = await availableRuntime();
    if (!runtime) {
      patch(replyId, { pending: false, text: "Download the Built-in model in App settings to use the assistant." });
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    const base = hostRef.current;
    const chatHost: ToolHost = {
      ...base,
      applyImportOps: (ops) => importRef.current.apply(ops, { origin: { by: "model" } }),
      confirm: (request) =>
        new Promise<boolean>((resolve) => {
          patch(replyId, { confirm: { ...request, resolve } });
        }),
    };
    let streamed = "";
    try {
      const outcome = await runInstruction({
        instruction,
        context: { view, blocks: chips.map((c) => c.block) },
        runtime,
        host: chatHost,
        signal: abort.signal,
        history: turns.current,
        // "rückgängig" / "nein, …": the last answer that changed the draft, while nothing came after it.
        undoLast: () => {
          const last = [...messagesRef.current]
            .reverse()
            .find((m) => m.role === "assistant" && m.outcome?.kind === "import" && !m.undone) as
            | Extract<ChatMessage, { role: "assistant" }>
            | undefined;
          if (!last || last.outcome?.kind !== "import" || importRef.current.currentDraft() !== last.outcome.after) return false;
          importRef.current.undo();
          patch(last.id, { undone: true });
          return true;
        },
        onAnswerText: (chunk) => {
          streamed += chunk;
          patch(replyId, { text: streamed });
        },
      });
      if (outcome.turn) turns.current = [...turns.current, outcome.turn].slice(-8);
      if (outcome.kind === "import" && outcome.changes.length > 0) {
        answers.current += 1;
        patch(replyId, { pending: false, outcome, answer: answers.current, text: "" });
        setHighlighted(replyId);
      } else {
        patch(replyId, {
          pending: false,
          outcome,
          text: outcome.kind === "answer" || outcome.kind === "none" ? outcome.text : "",
        });
      }
    } catch (error) {
      patch(replyId, {
        pending: false,
        text: abort.signal.aborted ? "Stopped." : `The model stopped: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setRunning(false);
    }
  }, []);

  const find = (id: number) => messages.find((m) => m.id === id && m.role === "assistant") as
    | Extract<ChatMessage, { role: "assistant" }>
    | undefined;

  const canUndo = (id: number) => {
    const m = find(id);
    return m?.outcome?.kind === "import" && !m.undone && importDraft.currentDraft() === m.outcome.after;
  };

  return {
    messages,
    running,
    send,
    stop: () => abortRef.current?.abort(),
    undo: (id) => {
      if (!canUndo(id)) return;
      importDraft.undo();
      patch(id, { undone: true });
      if (highlighted === id) setHighlighted(null);
    },
    canUndo,
    answerConfirm: (id, ok) => {
      const m = find(id);
      if (!m?.confirm || m.confirm.answered) return;
      m.confirm.resolve(ok);
      patch(id, { confirm: { ...m.confirm, answered: true } });
    },
    answerHint: (id) => patch(id, { hintAnswered: true }),
    highlighted,
    hideHighlight: () => setHighlighted(null),
  };
}
