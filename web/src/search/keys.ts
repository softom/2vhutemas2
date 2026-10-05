/**
 * Поиск по клавишам (Р-109): «/» и Ctrl+K открывают окно поиска, если человек
 * не печатает в поле. Само окно грузится только при первом открытии.
 */
export async function openSearch() {
  const { openSearch: open } = await import("./window");
  open();
}

export function bindSearchKeys() {
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
    const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (ctrlK || slash) {
      event.preventDefault();
      openSearch();
    }
  });
}
