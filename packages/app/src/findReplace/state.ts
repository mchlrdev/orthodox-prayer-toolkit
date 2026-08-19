import { variantKey, type ActiveVariant } from "../variant";

export function editorKey(blockId: string, col: ActiveVariant): string {
  return `${blockId}::${variantKey(col)}`;
}

export type FindReplaceState = {
  open: boolean;
  query: string;
  replaceWith: string;
  replaceExpanded: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  currentIndex: number;
};

export function createDefaultFindReplaceState(
  partial?: Partial<FindReplaceState>,
): FindReplaceState {
  return {
    open: false,
    query: "",
    replaceWith: "",
    replaceExpanded: false,
    matchCase: false,
    wholeWord: false,
    currentIndex: 0,
    ...partial,
  };
}

export function clampMatchIndex(index: number, matchCount: number): number {
  if (matchCount === 0) return 0;
  return ((index % matchCount) + matchCount) % matchCount;
}
