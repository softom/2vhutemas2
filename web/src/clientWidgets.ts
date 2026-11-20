import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface ClientWidgetProps {
  entity_id: number | null;
  design: string;
}

const selector = "[data-react-widget]";

export function observeWidgets(container: HTMLElement, registry: ReadonlyMap<string, ComponentType<ClientWidgetProps>>) {
  const roots = new Map<HTMLElement, Root>();

  function collect(node: Node, found: Set<HTMLElement>) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(selector)) found.add(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(host => found.add(host));
  }

  function reconcile(host: HTMLElement) {
    const root = roots.get(host);
    if (!container.contains(host)) {
      root?.unmount();
      roots.delete(host);
      return;
    }
    if (root) return;
    const component = registry.get(host.dataset.reactWidget ?? "");
    if (!component) return;
    const entityId = host.dataset.entityId === undefined ? null : Number(host.dataset.entityId);
    if (entityId !== null && (!Number.isSafeInteger(entityId) || entityId <= 0)) return;
    const next = createRoot(host);
    roots.set(host, next);
    next.render(createElement(component, { entity_id: entityId, design: host.dataset.design ?? "default" }));
  }

  const observer = new MutationObserver(records => {
    const affected = new Set<HTMLElement>();
    for (const record of records) {
      record.removedNodes.forEach(node => collect(node, affected));
      record.addedNodes.forEach(node => collect(node, affected));
    }
    affected.forEach(reconcile);
  });
  observer.observe(container, { childList: true, subtree: true });
  container.querySelectorAll<HTMLElement>(selector).forEach(reconcile);
  return () => {
    observer.disconnect();
    roots.forEach(root => root.unmount());
    roots.clear();
  };
}
