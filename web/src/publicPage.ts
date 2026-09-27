/** Небольшие улучшения готового HTML. Данные и текст уже на странице. */
export function enhancePublicPage() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-gallery]")];
  let current = 0;
  let opener: HTMLAnchorElement | undefined;
  const dialog = document.createElement("dialog");
  dialog.className = "reader-lightbox";
  dialog.setAttribute("aria-label", "Просмотр изображений");
  dialog.innerHTML = `<div class="reader-lightbox-actions"><button type="button" data-prev aria-label="Предыдущее изображение">←</button><button type="button" data-next aria-label="Следующее изображение">→</button><button type="button" data-close>Закрыть</button></div><figure><img alt=""><figcaption></figcaption></figure>`;
  const image = dialog.querySelector("img")!;
  const caption = dialog.querySelector("figcaption")!;
  const show = (index: number) => {
    current = (index + links.length) % links.length;
    const link = links[current];
    image.src = link.href;
    image.alt = link.querySelector("img")?.alt ?? "";
    caption.replaceChildren();
    const original = link.closest("figure")?.querySelector("figcaption");
    if (original) caption.append(...[...original.childNodes].map(node => node.cloneNode(true)));
  };
  if (links.length) {
    document.body.append(dialog);
    links.forEach((link, index) => link.addEventListener("click", (event) => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      show(index);
      dialog.showModal();
    }));
    dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-prev]")!.addEventListener("click", () => show(current - 1));
    dialog.querySelector("[data-next]")!.addEventListener("click", () => show(current + 1));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => opener?.focus());
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        show(current + (event.key === "ArrowLeft" ? -1 : 1));
      }
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy!);
      try {
        await navigator.clipboard.writeText(source?.textContent ?? "");
        button.textContent = "Скопировано";
      } catch {
        button.textContent = "Выделите и скопируйте текст выше";
      }
    });
  });
}
