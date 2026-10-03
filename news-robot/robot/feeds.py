"""Разбор лент RSS/Atom в единый вид материала.

feedparser терпит битый XML (AEC Magazine, Unreal) и сам перекодирует
windows-1251 (isicad). Фильтры источника — путь в адресе и ключевые слова —
отсекают шум до LLM, чтобы не платить за разбор 350 статей arXiv в день.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import warnings

from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning

warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)

TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|yclid$|mc_|ref$|from$)")


def canonical(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query) if not TRACKING.match(k)]
    path = parts.path or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))


def item_id(url: str) -> str:
    return hashlib.sha1(canonical(url).encode()).hexdigest()[:16]


def html_text(html: str | None) -> str:
    if not html:
        return ""
    text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class Item:
    id: str
    source_id: str
    url: str
    title: str
    summary: str
    published: str | None
    author: str | None = None
    content_html: str | None = None
    images: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("content_html")
        return d


def _published(entry) -> str | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        value = entry.get(key)
        if value:
            return datetime(*value[:6], tzinfo=timezone.utc).isoformat()
    # Нестандартный пояс «GMT+4» (archi.ru) feedparser не разбирает.
    for key in ("published", "updated"):
        raw = entry.get(key)
        if not raw:
            continue
        fixed = re.sub(r"GMT([+-])(\d{1,2})(?::?(\d{2}))?$",
                       lambda m: f"{m.group(1)}{int(m.group(2)):02d}{m.group(3) or '00'}", raw.strip())
        try:
            return parsedate_to_datetime(fixed).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            continue
    return None


def _images(entry, content_html: str | None) -> list[dict]:
    found: list[dict] = []
    for m in entry.get("media_content", []) or []:
        if m.get("url") and (m.get("medium") == "image" or "image" in (m.get("type") or "")
                             or re.search(r"\.(jpe?g|png|webp|avif)(\?|$)", m["url"], re.I)):
            found.append({"url": m["url"], "caption": m.get("description")})
    for m in entry.get("media_thumbnail", []) or []:
        if m.get("url"):
            found.append({"url": m["url"], "caption": None})
    for enc in entry.get("enclosures", []) or []:
        if "image" in (enc.get("type") or "") and enc.get("href"):
            found.append({"url": enc["href"], "caption": None})
    if content_html:
        soup = BeautifulSoup(content_html, "lxml")
        for fig in soup.find_all(["figure", "img"], limit=12):
            img = fig if fig.name == "img" else fig.find("img")
            if not img or not img.get("src"):
                continue
            cap = fig.find("figcaption") if fig.name == "figure" else None
            found.append({"url": img["src"], "caption": cap.get_text(" ", strip=True) if cap else img.get("alt")})
    seen, unique = set(), []
    for f in found:
        if f["url"] not in seen:
            seen.add(f["url"])
            unique.append(f)
    return unique


class NotAFeed(Exception):
    pass


def parse(source: dict, body: bytes, headers: dict[str, str]) -> list[Item]:
    """Материалы ленты. Пустая, но настоящая лента (arXiv в выходные) — пустой список, не ошибка."""
    feed = feedparser.parse(body, response_headers={k.lower(): v for k, v in headers.items()})
    if not feed.entries and not feed.version:
        raise NotAFeed("ответ не похож на ленту")
    items = []
    for entry in feed.entries:
        url = entry.get("link")
        title = html_text(entry.get("title"))
        if not url or not title:
            continue
        content_html = None
        if entry.get("content"):
            content_html = max((c.get("value") or "" for c in entry["content"]), key=len)
        summary = html_text(entry.get("summary"))
        items.append(Item(
            id=item_id(url),
            source_id=source["id"],
            url=canonical(url),
            title=title,
            summary=summary[:1200],
            published=_published(entry),
            author=entry.get("author"),
            content_html=content_html,
            images=_images(entry, content_html or entry.get("summary")),
        ))
    return items


def passes_filters(source: dict, item: Item) -> bool:
    paths = source.get("path")
    if paths and not any(p in item.url for p in paths):
        return False
    words = source.get("keywords")
    if words:
        hay = f"{item.title} {item.summary}".lower()
        if not any(w.lower() in hay for w in words):
            return False
    return True
