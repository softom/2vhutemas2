/** Граф связей записи: силовая раскладка, узлы можно оттягивать. */
type Node = { hidden?: boolean; deep?: boolean; x: number; y: number; vx: number; vy: number; fixed: boolean; r: number; href?: string; label: string; tip: string; el?: SVGGElement };
type Data = { center: string; nodes: { href: string; title: string; role: string; note: string }[]; extra?: { a: string; at: string; b: string; bt: string }[] };

const NS = "http://www.w3.org/2000/svg";
const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + "…" : text);

export function mountRelGraph(host: HTMLElement) {
  if (host.dataset.ready) return;
  host.dataset.ready = "1";
  const data: Data = JSON.parse(host.dataset.relGraph ?? "{}");
  const W = Math.max(host.clientWidth, 280);
  const H = W < 520 ? 380 : 440;
  const svg = make("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "rel-svg" });
  host.append(svg);

  // Одна запись — один узел, даже если связей с ней несколько.
  const byHref = new Map<string, Node>();
  const nodes: Node[] = [{ x: W / 2, y: H / 2, vx: 0, vy: 0, fixed: false, r: 9, label: clip(data.center, 28), tip: data.center }];
  const edges: [Node, Node][] = [];
  const edgeDeep: boolean[] = [];
  const count = data.nodes.length;
  data.nodes.forEach((n, i) => {
    if (byHref.has(n.href)) return;
    const a = (i / count) * Math.PI * 2;
    const node: Node = {
      x: W / 2 + Math.cos(a) * 140, y: H / 2 + Math.sin(a) * 140, vx: 0, vy: 0, fixed: false, r: 5,
      href: n.href, label: clip(n.title, 26),
      tip: [n.title, n.role && `(${n.role})`, n.note].filter(Boolean).join(" "),
    };
    byHref.set(n.href, node);
    nodes.push(node);
    edges.push([nodes[0], node]);
    edgeDeep.push(false);
  });
  const known = new Map(byHref);
  const seen = new Set<string>();
  // Связи соседей: новые записи — второй круг, скрыты до галочки.
  const ensure = (href: string, title: string, near?: Node) => {
    let n = known.get(href);
    if (!n) {
      n = { x: (near?.x ?? W / 2) + Math.random() * 40 - 20, y: (near?.y ?? H / 2) + Math.random() * 40 - 20, vx: 0, vy: 0, fixed: false, r: 3.5, deep: true, hidden: true, href, label: clip(title, 24), tip: title };
      known.set(href, n);
      nodes.push(n);
    }
    return n;
  };
  for (const x of data.extra ?? []) {
    if (x.a === location.pathname || x.b === location.pathname) continue;
    const key = [x.a, x.b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const a = ensure(x.a, x.at, known.get(x.b));
    const b = ensure(x.b, x.bt, a);
    edges.push([a, b]);
    edgeDeep.push(true);
  }

  const lines = edges.map((_, i) => svg.appendChild(make("line", { class: edgeDeep[i] ? "rel-edge is-deep" : "rel-edge" })));
  for (const node of nodes) {
    const g = make("g", { class: node.href ? "rel-node" : "rel-node is-center" });
    const title = make("title");
    title.textContent = node.tip;
    const text = make("text", { x: node.r + 5, y: 4 });
    text.textContent = node.label;
    g.append(title, make("circle", { r: node.r }), text);
    node.el = g;
    svg.append(g);
  }

  const show = (on: boolean) => {
    for (const n of nodes) if (n.deep) { n.hidden = !on; n.el!.style.display = on ? "" : "none"; }
    lines.forEach((l, i) => { l.style.display = !on && edgeDeep[i] ? "none" : ""; });
    wake(0.8);
  };
  let alpha = 1;
  let running = false;
  const tick = () => {
    for (const a of nodes) for (const b of nodes) {
      if (a === b || a.hidden || b.hidden) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = Math.max(dx * dx + dy * dy, 36);
      const d = Math.sqrt(d2);
      const f = (2600 * alpha) / d2;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
    }
    edges.forEach(([a, b], i) => {
      if (a.hidden || b.hidden) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - (edgeDeep[i] ? 70 : 120)) * 0.04;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    });
    for (const n of nodes) {
      if (n.hidden) continue;
      n.vx += (W / 2 - n.x) * 0.006; n.vy += (H / 2 - n.y) * 0.006;
      if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x = Math.min(W - 10, Math.max(10, n.x));
      n.y = Math.min(H - 10, Math.max(10, n.y));
      n.el!.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    }
    edges.forEach(([a, b], i) => {
      lines[i].setAttribute("x1", String(a.x)); lines[i].setAttribute("y1", String(a.y));
      lines[i].setAttribute("x2", String(b.x)); lines[i].setAttribute("y2", String(b.y));
    });
    alpha *= 0.992;
  };
  const loop = () => {
    tick();
    if (alpha > 0.02 && document.contains(svg)) requestAnimationFrame(loop); else running = false;
  };
  const wake = (a = 0.6) => { alpha = Math.max(alpha, a); if (!running) { running = true; requestAnimationFrame(loop); } };
  for (let i = 0; i < 60; i++) tick();
  show(false);
  host.addEventListener("rel-extra", (e) => show((e as CustomEvent<boolean>).detail));

  // Перетаскивание: узел держится за курсор, остальные подтягиваются.
  for (const node of nodes) {
    node.el!.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      node.el!.setPointerCapture(event.pointerId);
      const start = { x: event.clientX, y: event.clientY };
      let moved = false;
      node.fixed = true;
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const move = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) moved = true;
        node.x = (e.clientX - rect.left) * scale; node.y = (e.clientY - rect.top) * scale;
        node.vx = node.vy = 0;
        wake(0.5);
      };
      const up = () => {
        node.el!.removeEventListener("pointermove", move);
        node.el!.removeEventListener("pointerup", up);
        node.el!.removeEventListener("pointercancel", up);
        node.fixed = false;
        if (!moved && node.href) location.href = node.href;
      };
      node.el!.addEventListener("pointermove", move);
      node.el!.addEventListener("pointerup", up);
      node.el!.addEventListener("pointercancel", up);
    });
  }
}
