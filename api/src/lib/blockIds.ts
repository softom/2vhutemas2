/** Copies from a rich-text editor can retain the original block ID.
 * Keep the first occurrence (and existing anchors), assign only copies new IDs.
 * Never change content, media IDs, entity IDs or occurrence/target references.
 */
export function uniqueBlockIds<T extends { id?: string; children?: T[] }>(blocks: T[]): T[] {
  const reserved = new Set<string>();
  const collect = (list: T[]) => {
    for (const block of list) {
      if (block.id) reserved.add(block.id);
      if (block.children) collect(block.children);
    }
  };
  collect(blocks);
  const seen = new Set<string>();
  const walk = (list: T[]): T[] => list.map((block) => {
    const copy = { ...block };
    if (copy.id) {
      if (seen.has(copy.id)) {
        do { copy.id = crypto.randomUUID(); } while (reserved.has(copy.id));
        reserved.add(copy.id);
      }
      seen.add(copy.id);
    }
    if (copy.children) copy.children = walk(copy.children);
    return copy;
  });
  return walk(blocks);
}
