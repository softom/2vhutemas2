export function appendCatalogItems<T extends { id: number }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map(item => item.id));
  const items = [...current];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}
