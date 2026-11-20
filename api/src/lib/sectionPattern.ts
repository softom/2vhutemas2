/** Slots must arrive in reading order. Filtering happens before pagination. */
export function fillSectionPattern<Row, Slot, Result>(
  rows: readonly Row[],
  slots: readonly Slot[],
  offset: number,
  render: (row: Row, slot: Slot) => Result,
) {
  if (!slots.length) throw new RangeError("Section pattern must contain a slot");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= slots.length) {
    throw new RangeError("Invalid section pattern offset");
  }

  const items = rows.map((row, index) => {
    const position = offset + index;
    const slot = slots[position % slots.length];
    return { slot, repeat: Math.floor(position / slots.length), content: render(row, slot) };
  });
  return { items, nextOffset: (offset + rows.length) % slots.length };
}
