"""Вежливая загрузка страниц и лент.

Робот представляется своим именем и адресом проекта, читает robots.txt,
держит паузу между запросами к одному сайту и не обходит защиту: ответ
403, проверка Cloudflare или запрет robots.txt — это отказ, а не повод
притвориться браузером (WIKI/Новости.md, раздел 4).
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

USER_AGENT = "2vhutemas-news-robot/0.1 (+https://2vhutemas.ru/about)"
ROBOT_NAME = "2vhutemas-news-robot"


class Robots:
    """robots.txt по правилам Google: шаблоны * и $, побеждает самое длинное правило, Allow — при равенстве.

    Стандартный urllib.robotparser читает «Disallow: /?» как запрет всего сайта (stroygaz.ru),
    поэтому разбор свой.
    """

    def __init__(self, text: str):
        groups: list[tuple[list[str], list[tuple[bool, str]], float | None]] = []
        agents: list[str] = []
        rules: list[tuple[bool, str]] = []
        delay: float | None = None
        last_was_agent = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (x.strip() for x in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if not last_was_agent and agents:
                    groups.append((agents, rules, delay))
                    agents, rules, delay = [], [], None
                agents.append(value.lower())
                last_was_agent = True
                continue
            last_was_agent = False
            if key in ("allow", "disallow") and agents:
                if value:
                    rules.append((key == "allow", value))
            elif key == "crawl-delay" and agents:
                try:
                    delay = float(value)
                except ValueError:
                    pass
        if agents:
            groups.append((agents, rules, delay))
        mine = [g for g in groups if any(a != "*" and a in ROBOT_NAME for a in g[0])]
        chosen = mine or [g for g in groups if "*" in g[0]]
        self.rules = [r for g in chosen for r in g[1]]
        delays = [g[2] for g in chosen if g[2] is not None]
        self.crawl_delay = max(delays) if delays else None

    @staticmethod
    def _regex(pattern: str) -> re.Pattern:
        end = pattern.endswith("$")
        body = re.escape(pattern[:-1] if end else pattern).replace(r"\*", ".*")
        return re.compile(body + ("$" if end else ""))

    def allowed(self, path: str) -> bool:
        best: tuple[int, bool] | None = None
        for allow, pattern in self.rules:
            if self._regex(pattern).match(path):
                cand = (len(pattern), allow)
                if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                    best = cand
        return best is None or best[1]


class FetchError(Exception):
    def __init__(self, url: str, reason: str, status: int | None = None):
        super().__init__(f"{reason}: {url}")
        self.url = url
        self.reason = reason
        self.status = status


@dataclass
class Response:
    url: str
    status: int
    headers: dict[str, str]
    content: bytes

    @property
    def not_modified(self) -> bool:
        return self.status == 304


class Fetcher:
    def __init__(self, delay: float = 2.0, timeout: float = 25.0, max_bytes: int = 8 * 1024 * 1024):
        self.delay = delay
        self.max_bytes = max_bytes
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8"},
            timeout=timeout,
            follow_redirects=True,
        )
        self._last: dict[str, float] = {}
        self._robots: dict[str, Robots | None] = {}
        self._delays: dict[str, float] = {}

    def _wait(self, host: str) -> None:
        last = self._last.get(host)
        if last is not None:
            pause = max(self.delay, self._delays.get(host, 0)) - (time.monotonic() - last)
            if pause > 0:
                time.sleep(pause)
        self._last[host] = time.monotonic()

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            robots: Robots | None = None
            try:
                self._wait(parts.netloc)
                r = self.client.get(origin + "/robots.txt")
                # Нет robots.txt (4xx) — ограничений нет.
                if r.status_code == 200:
                    robots = Robots(r.text)
                    if robots.crawl_delay:
                        self._delays[parts.netloc] = min(robots.crawl_delay, 60.0)
            except httpx.HTTPError:
                robots = None
            self._robots[origin] = robots
        robots = self._robots[origin]
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        return robots is None or robots.allowed(path)

    def get(self, url: str, etag: str | None = None, modified: str | None = None,
            check_robots: bool = True) -> Response:
        if check_robots and not self.allowed(url):
            raise FetchError(url, "запрещено robots.txt")
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if modified:
            headers["If-Modified-Since"] = modified
        self._wait(urlsplit(url).netloc)
        try:
            with self.client.stream("GET", url, headers=headers) as r:
                if r.status_code == 304:
                    return Response(str(r.url), 304, dict(r.headers), b"")
                if r.status_code >= 400:
                    reason = "защита от ботов" if _is_challenge(r) else f"HTTP {r.status_code}"
                    raise FetchError(url, reason, r.status_code)
                chunks, size = [], 0
                for chunk in r.iter_bytes():
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise FetchError(url, "ответ больше предела")
                    chunks.append(chunk)
                return Response(str(r.url), r.status_code, dict(r.headers), b"".join(chunks))
        except httpx.HTTPError as e:
            raise FetchError(url, f"сеть: {type(e).__name__}") from e

    def close(self) -> None:
        self.client.close()


def _is_challenge(r: httpx.Response) -> bool:
    server = r.headers.get("server", "").lower()
    return r.status_code in (403, 503) and ("cloudflare" in server or "cf-ray" in r.headers)
