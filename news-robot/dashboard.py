"""Пульт робота новостей — локальная страница редактора.

    python news-robot/dashboard.py            # http://127.0.0.1:8765

Что видно: сайты, которые мониторим, и как прошёл их обход; новости, которые
робот отобрал, оценил и перевёл; стек на публикацию — слоты выхода
(news.release.slots) по дням; прогресс каждого этапа текущего прогона.

Пульт читает рабочие папки робота (out/, .state/) и ничего в состоянии робота
не меняет: решения «да / нет» уходят в ящик inbox/inbox.jsonl, как со страницы
/robot на сайте. Стек принадлежит редактору — inbox/queue.json; позже из него
будет брать планировщик (WIKI/Новости.md, раздел 6). Это рабочий инструмент
до выкладки робота на сервер: те же данные покажет страница /robot.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from robot import pipeline  # noqa: E402
from robot.state import State  # noqa: E402

OUT = ROOT / "out"
STATE = ROOT / ".state"
INBOX = ROOT / "inbox" / "inbox.jsonl"
QUEUE = ROOT / "inbox" / "queue.json"  # там же, где у сайта: единственная папка робота, куда пишет API
RUN_ID = re.compile(r"^\d{8}-\d{6}$")
MSK = timezone(timedelta(hours=3))


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def runs() -> list[str]:
    return sorted((p.name for p in OUT.iterdir() if p.is_dir() and RUN_ID.match(p.name)), reverse=True) \
        if OUT.exists() else []


def log_lines(run_id: str) -> list[dict]:
    path = OUT / run_id / "log.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def run_view(run_id: str) -> dict:
    """Всё о прогоне: итог, если он есть, иначе — собранное из журнала и промежуточных файлов."""
    d = OUT / run_id
    summary = read_json(d / "summary.json")
    log = log_lines(run_id)
    progress = read_json(d / "progress.json")
    cfg_sources = {s["id"]: s for s in pipeline.all_sources(State(STATE / "state.json"))}
    start = next((r for r in log if r.get("msg") == "старт"), {})
    feeds_total = start.get("sources") or len(cfg_sources)
    feeds = summary["feeds"] if summary else [
        {"id": r["source"], "title": cfg_sources.get(r["source"], {}).get("title", r["source"]),
         "status": "ошибка: " + r["error"] if r.get("error") else "ok", "items": r.get("items", 0),
         "new": r.get("new", 0)} for r in log if r.get("stage") == "crawl" and r.get("source")]
    candidates = summary["candidates"] if summary else (read_json(d / "candidates.json") or [])
    partial = [] if candidates else (read_json(d / "triage_partial.json") or [])
    news = summary["news"] if summary else [
        {"candidate": s["candidate"], "news": s.get("news"), "issues": s.get("issues", []),
         "warnings": s.get("warnings", [])} for s in (read_json(d / "news.json") or [])]
    items = len(read_json(d / "items.json") or [])
    triage_batches = [r for r in log if r.get("stage") == "triage" and r.get("msg") in ("пачка оценена", "пачка не оценена")]
    written = [r for r in log if r.get("stage") == "write"]
    stages = (progress or {}).get("stages") or {
        "crawl": [len(feeds), feeds_total],
        "triage": [sum(r.get("size", 0) for r in triage_batches), items],
        "write": [len(written), max(len(written), len(news))],
    }
    last = log[-1] if log else {}
    return {
        "id": run_id, "running": summary is None, "status": summary["status"] if summary else "идёт",
        "since": (summary or {}).get("since") or start.get("since"), "llm_note": (summary or {}).get("llm_note"),
        "last": {"ts": last.get("ts"), "stage": last.get("stage"), "msg": last.get("msg")},
        "stages": stages, "items": items, "feeds": feeds, "candidates": candidates, "partial": partial,
        "news": news, "link_domains": (summary or {}).get("link_domains", []),
        "errors": [r for r in log if r.get("level") in ("warn", "error")][-30:],
    }


def slots() -> dict:
    cfg = pipeline.load_config()
    times = cfg.get("news.release.slots") or ["09:30", "13:00", "18:00"]
    today = datetime.now(MSK).date()
    return {"times": times, "days": [(today + timedelta(days=i)).isoformat() for i in range(4)]}


def queue() -> dict:
    q = read_json(QUEUE, {"items": []})
    q.update(slots())
    return q


def save_queue(q: dict) -> None:
    QUEUE.parent.mkdir(parents=True, exist_ok=True)
    tmp = QUEUE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"items": q["items"]}, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(QUEUE)


def queue_action(body: dict) -> dict:
    q = queue()
    items = q["items"]
    key = str(body.get("story_key", ""))
    action = body.get("action")
    taken = {(i["date"], i["time"]) for i in items if i["story_key"] != key}
    if action == "add":
        if any(i["story_key"] == key for i in items):
            raise ValueError("история уже в стеке")
        now_msk = datetime.now(MSK)
        free = [(d, t) for d in q["days"] for t in q["times"]
                if (d, t) not in taken and f"{d} {t}" > now_msk.strftime("%Y-%m-%d %H:%M")]
        if not free:
            raise ValueError("свободных слотов на ближайшие дни нет")
        date, time = free[0]
        items.append({"story_key": key, "run_id": body.get("run_id"), "title": body.get("title"),
                      "topic": body.get("topic"), "final": body.get("final"), "url": body.get("url"),
                      "date": date, "time": time, "added_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    elif action == "move":
        date, time = str(body.get("date")), str(body.get("time"))
        if time not in q["times"]:
            raise ValueError("время — только из слотов выхода")
        other = next((i for i in items if i["date"] == date and i["time"] == time and i["story_key"] != key), None)
        mine = next(i for i in items if i["story_key"] == key)
        if other:  # слот занят — меняемся местами
            other["date"], other["time"] = mine["date"], mine["time"]
        mine["date"], mine["time"] = date, time
    elif action == "remove":
        q["items"] = [i for i in items if i["story_key"] != key]
    else:
        raise ValueError("action: add, move или remove")
    q["items"].sort(key=lambda i: (i["date"], i["time"]))
    save_queue(q)
    return queue()


def state_view() -> dict:
    st = State(STATE / "state.json")
    ids = runs()
    learned = st.data.get("learned") or {}
    return {
        "runs": [{"id": r, "done": (OUT / r / "summary.json").exists()} for r in ids[:30]],
        "sources": pipeline.sources_snapshot(st),
        "candidates": sorted(st.candidates().values(), key=lambda c: (c.get("status") != "ждёт решения", -c.get("count", 0))),
        "judged": {k: v["verdict"] for k, v in st.data.get("judgments", {}).items()},
        "pending": [json.loads(l) for l in INBOX.read_text(encoding="utf-8").splitlines() if l.strip()] if INBOX.exists() else [],
        "learned": {k: v for k, v in learned.items() if k != "history"},
        "queue": queue(),
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, data, ctype="application/json; charset=utf-8"):
        body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # тихо: пульт опрашивают каждые 3 секунды
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        try:
            if url.path == "/":
                return self._send(200, (ROOT / "dashboard.html").read_bytes(), "text/html; charset=utf-8")
            if url.path == "/api/state":
                return self._send(200, state_view())
            m = re.match(r"^/api/runs/(\d{8}-\d{6})$", url.path)
            if m:
                return self._send(200, run_view(m.group(1)))
            m = re.match(r"^/api/runs/(\d{8}-\d{6})/log$", url.path)
            if m:
                start = int((parse_qs(url.query).get("from") or ["0"])[0])
                rows = log_lines(m.group(1))
                return self._send(200, {"items": rows[start:start + 500], "next": min(len(rows), start + 500)})
            return self._send(404, {"error": "нет такого адреса"})
        except Exception as e:  # noqa: BLE001 — пульт показывает ошибку, а не падает
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if self.path == "/api/queue":
                return self._send(200, queue_action(body))
            if self.path == "/api/inbox":
                if body.get("action") not in ("judge", "decide", "propose"):
                    raise ValueError("action: judge, decide или propose")
                body.update(by="пульт", ts=datetime.now(timezone.utc).isoformat(timespec="seconds"))
                INBOX.parent.mkdir(parents=True, exist_ok=True)
                with open(INBOX, "a", encoding="utf-8") as f:
                    f.write(json.dumps(body, ensure_ascii=False) + "\n")
                return self._send(202, {"queued": body})
            return self._send(404, {"error": "нет такого адреса"})
        except (ValueError, StopIteration) as e:
            return self._send(400, {"error": str(e) or "нет такой истории в стеке"})


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Пульт робота: http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
