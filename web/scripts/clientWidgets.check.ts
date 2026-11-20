import { createElement, useEffect, useState } from "react";
import { observeWidgets, type ClientWidgetProps } from "../src/clientWidgets";

export async function checkLifecycle() {
  let listeners = 0;
  let events = 0;
  function Counter({ design, entity_id }: ClientWidgetProps) {
    const [count, setCount] = useState(0);
    useEffect(() => {
      const hear = () => { events++; };
      window.addEventListener("widget-ping", hear);
      listeners++;
      return () => { window.removeEventListener("widget-ping", hear); listeners--; };
    }, []);
    return createElement("button", { onClick: () => setCount(n => n + 1) }, design + "/" + entity_id + "/" + count);
  }
  async function until(condition: () => boolean, label: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(label);
  }
  const scope = document.createElement("main");
  document.body.append(scope);
  const markup = '<div data-react-widget="probe" data-entity-id="42" data-design="compact"></div>';
  scope.innerHTML = '<section>' + markup + '</section><article>' + markup + '</article>';
  const [slot, block] = scope.children;
  const stop = observeWidgets(scope, new Map([["probe", Counter]]));
  try {
    await until(() => listeners === 2, "initial mount");
    slot.querySelector("button")!.click();
    await until(() => slot.textContent === "compact/42/1" && block.textContent === "compact/42/0", "independent state");
    block.remove();
    await until(() => listeners === 1, "subtree removal");
    slot.innerHTML = markup;
    await until(() => listeners === 1 && slot.textContent === "compact/42/0", "replacement resets state");
    window.dispatchEvent(new Event("widget-ping"));
    if (events !== 1) throw new Error("stale listener");
  } finally {
    stop();
    scope.remove();
  }
  if (listeners !== 0) throw new Error("final cleanup");
  return "passed";
}
