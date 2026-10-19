/**
 * Block-menu structure ops must flush uncommitted cell typing, then read the
 * editor ctx — not the React `prayer` from the render that opened the menu.
 *
 * Right-click can keep the cell focused until a menu item is chosen; blur then
 * races the click. Idle (~400ms) also has not committed a younger burst.
 *
 * Flush uses the existing cell commit path (no second serialize). That path
 * must write the new Prayer onto `ctx.current` in the same turn, the way
 * `saveDraft` relies on flush updating session `stateRef`.
 */

export function snapshotAfterFlush<T>(
  flush: () => void,
  ctx: { current: T },
): T {
  flush();
  return ctx.current;
}

/** Keep ctx.prayer in lockstep with a same-turn onChange (flush or structure). */
export function rememberCtxPrayer<T extends { prayer: unknown }>(
  ctx: { current: T },
  prayer: T["prayer"],
): void {
  ctx.current = { ...ctx.current, prayer };
}
