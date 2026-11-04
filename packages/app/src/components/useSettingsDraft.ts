import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyIdleCommitTrigger,
  cancelIdleCommitTimer,
  nativeEventIsComposing,
  type IdleCommitTimer,
} from "../idleCommit";

export type SettingsDraftOptions = {
  /** Commit while focused after idle. Off for identity fields (lang / edition). */
  idle?: boolean;
  /** Commit on every change (New prayer id, so Create sees the value). */
  live?: boolean;
};

/**
 * Text field value that stays local while typing and writes through on idle
 * and blur, so a long Prayer behind settings does not re-render per key.
 */
export function useSettingsDraft(
  value: string,
  onCommit: (next: string) => void,
  options: SettingsDraftOptions = {},
) {
  const live = options.live === true;
  const idle = !live && options.idle !== false;
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  const onCommitRef = useRef(onCommit);
  const lastCommittedRef = useRef(value);
  const timerRef = useRef<IdleCommitTimer>({ id: null });
  draftRef.current = draft;
  onCommitRef.current = onCommit;

  const flush = useCallback(() => {
    cancelIdleCommitTimer(timerRef.current);
    const next = draftRef.current;
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onCommitRef.current(next);
  }, []);

  useEffect(() => {
    if (value === lastCommittedRef.current) return;
    lastCommittedRef.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      cancelIdleCommitTimer(timerRef.current);
      const next = draftRef.current;
      if (next === lastCommittedRef.current) return;
      lastCommittedRef.current = next;
      onCommitRef.current(next);
    };
  }, []);

  return {
    value: draft,
    onChange: (e: {
      currentTarget: { value: string };
      nativeEvent: Event;
    }) => {
      const raw = e.currentTarget.value;
      setDraft(raw);
      if (live) {
        lastCommittedRef.current = raw;
        onCommitRef.current(raw);
        return;
      }
      if (!idle) return;
      applyIdleCommitTrigger(
        timerRef.current,
        {
          type: "input",
          isComposing: nativeEventIsComposing(e.nativeEvent),
        },
        flush,
      );
    },
    onBlur: () => {
      flush();
    },
    onKeyDown: (e: {
      key: string;
      currentTarget: EventTarget;
      preventDefault: () => void;
    }) => {
      if (e.key !== "Enter") return;
      if (e.currentTarget instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      flush();
    },
  };
}
