"""Источники без открытой ленты: страница-список материалов.

Parametric Architecture закрывает ленты в robots.txt, но страницы разделов
и статьи открыты; у Проекта России, Renga и nanoCAD лент нет вовсе.
Робот читает страницу-список, берёт адреса статей по шаблону источника,
у новых адресов читает заголовок, описание, дату и обложку из разметки
самой статьи (og:*, article:published_time, JSON-LD) — как поисковик.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from .feeds import Item, canonical, html_text, item_id
from .fetch import FetchError, Fetcher


def article_links(source: dict, html: str, base: str) -> list[str]:
    pattern = re.compile(source["link_pattern"]) if source.get("link_pattern") else None
    host = urlsplit(base).netloc
    soup = BeautifulSoup(html, "lxml")
    found: list[str] = []
    for a in soup.select("article a[href], h1 a[href], h2 a[href], h3 a[href], h4 a[href], .news a[href]"):
        url = canonical(urljoin(base, a["href"]))
        if urlsplit(url).netloc != host:
            continue
        if pattern and not pattern.search(url):
            continue
        if url not in found:
            found.append(url)
    return found


def _date(soup: BeautifulSoup) -> str | None:
    for prop in ("article:published_time", "og:published_time", "datePublished"):
        m = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"itemprop": prop})
        if m and m.get("content"):
            return _iso(m["content"])
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (ValueError, TypeError):
            continue
        for node in data if isinstance(data, list) else data.get("@graph", [data]):
            if isinstance(node, dict) and node.get("datePublished"):
                return _iso(node["datePublished"])
    t = soup.find("time", datetime=True)
    return _iso(t["datetime"]) if t else None


def _iso(value: str) -> str | None:
    try:
        d = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()


def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    m = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
    return m.get("content") if m and m.get("content") else None


def read(source: dict, fetcher: Fetcher, is_seen, since: datetime, limit: int) -> tuple[list[Item], list[str], dict]:
    """Новые материалы со страниц-списков. Возвращает материалы, старые адреса (пометить виденными) и счёт."""
    urls = source["list_url"] if isinstance(source["list_url"], list) else [source["list_url"]]
    links: list[str] = []
    for list_url in urls:
        r = fetcher.get(list_url)
        for link in article_links(source, r.content.decode("utf-8", "replace"), r.url):
            if link not in links:
                links.append(link)
    fresh = [u for u in links if not is_seen(item_id(u))]
    items, old, errors = [], [], 0
    for url in fresh[:limit]:
        try:
            r = fetcher.get(url)
        except FetchError:
            errors += 1
            continue
        html = r.content.decode("utf-8", "replace")
        soup = BeautifulSoup(html, "lxml")
        published = _date(soup)
        if published and datetime.fromisoformat(published) < since:
            # Виденным навсегда помечаем только по-настоящему старое: статья за день до окна
            # прогона ещё может пригодиться догоняющему прогону (конкурс PA выпал так, Р-100).
            if datetime.fromisoformat(published) < datetime.now(timezone.utc) - timedelta(days=30):
                old.append(url)
            continue
        title = _meta(soup, "og:title") or (soup.title.string if soup.title else "") or ""
        image = _meta(soup, "og:image")
        items.append(Item(
            id=item_id(url), source_id=source["id"], url=canonical(url),
            title=html_text(title), summary=html_text(_meta(soup, "og:description") or "")[:1200],
            published=published, author=_meta(soup, "author"), content_html=None,
            images=[{"url": image, "caption": None}] if image else [],
        ))
    return items, old, {"links": len(links), "fresh": len(fresh), "read": min(len(fresh), limit), "errors": errors}
