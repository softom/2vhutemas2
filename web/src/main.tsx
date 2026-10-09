// Готовое публичное содержание не заменяется приложением редактора.
import "./fonts.css";
import "./styles.css";
import { enhancePublicPage } from "./publicPage";

if (document.querySelector("[data-public-page]")) {
  enhancePublicPage();
} else {
  import("./appMount").catch(() => {
    const message = document.createElement("p");
    message.className = "notice";
    message.textContent = "Не удалось загрузить приложение. Обновите страницу, чтобы повторить.";
    document.getElementById("root")?.append(message);
  });
}
