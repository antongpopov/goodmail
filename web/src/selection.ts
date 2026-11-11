// Row selection helpers for the message list (pure, so they can be unit-tested).
export type HasUid = { uid: number };

export const allSelected = (sel: ReadonlySet<number>, items: readonly HasUid[]) => items.length > 0 && items.every((m) => sel.has(m.uid));
export const someSelected = (sel: ReadonlySet<number>, items: readonly HasUid[]) => !allSelected(sel, items) && items.some((m) => sel.has(m.uid));

/** The toolbar tickbox: select every row, or clear the selection when every row is already selected. */
export const toggleAll = (sel: ReadonlySet<number>, items: readonly HasUid[]): Set<number> =>
  allSelected(sel, items) ? new Set() : new Set(items.map((m) => m.uid));

/** A day header's tickbox: add (or remove) just that group's rows and leave the rest of the selection alone. */
export const toggleGroup = (sel: ReadonlySet<number>, items: readonly HasUid[]): Set<number> => {
  const next = new Set(sel);
  const all = allSelected(sel, items);
  for (const m of items) (all ? next.delete(m.uid) : next.add(m.uid));
  return next;
};
