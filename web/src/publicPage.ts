/** Небольшие улучшения готового HTML. Данные и текст уже на странице. */

/** Гость читает готовый HTML, без загрузки клиента авторизации. */
async function authenticatedCard() {
  try {
    if (!Object.keys(localStorage).some(key => /^sb-.+-auth-token$/.test(key))) return;
    const { api, supabase } = await import("./api");
    const { html, viewer: me } = await api.siteHeader(location.pathname);
    const header = document.querySelector<HTMLElement>("[data-site-header]");
    if (header) {
      header.innerHTML = html;
      header.querySelector('[data-action="signout"]')?.addEventListener("click", async () => {
        await supabase.auth.signOut();
        location.reload();
      });
    }
    if (!me.authenticated) return;
    const key = document.querySelector<HTMLElement>("[data-entity-key]")?.dataset.entityKey;
    const canReadDrafts = me.permissions.some(p => ["edit", "review", "su"].includes(p));
    if (key && canReadDrafts) {
      await api.openMediaSession();
      const card = await api.entityCardHtml(key);
      const main = document.querySelector(".ssr main");
      if (main) {
        // HTML формирует единственный серверный рендер с экранированием данных.
        main.innerHTML = card.html;
        document.title = card.title;
        history.replaceState(history.state, "", card.path + location.search + location.hash);
      }
    }
    const container = document.querySelector<HTMLElement>("[data-reader-edit]");
    if (!container || !me.permissions.some(p => p === "edit" || p === "su")) return;
    const link = document.createElement("a");
    link.href = container.dataset.href!;
    link.className = "reader-edit-link";
    link.title = "Править";
    link.setAttribute("aria-label", "Править запись");
    link.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg>';
    container.append(link);
    container.hidden = false;
  } catch {
    // Опубликованная карточка остаётся читаемой при недоступности сессии/API.
  }
}

export async function enhancePublicPage() {
  await authenticatedCard();
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
