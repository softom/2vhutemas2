"""Полный текст статьи и её фотографии с подписями.

Порядок: полный текст из ленты (Dezeen) → страница статьи → открытый
REST API WordPress. Защиту сайта не обходим: если ни один путь не дал
текста, робот работает по описанию из ленты и помечает это.
"""

from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlsplit

import trafilatura
from bs4 import BeautifulSoup

from .feeds import Item, html_text
from .fetch import FetchError, Fetcher

CREDIT = re.compile(
    r"(photo(graph(y|er)?)?s?\s*(by|:|©)|images?\s*(by|:|courtesy)|courtesy\s+(of\s+)?|"
    r"credit\s*:|rendering\s*(by|:)|фото(граф(ия|ии|ии:))?\s*[:—-]|©)", re.I)
GENERAL_CREDIT = re.compile(r"(photography|images?|photos?)\s+(is|are)\s+(by|courtesy of)\s+([^.]+)", re.I)
MIN_TEXT = 600
NOT_SOURCES = re.compile(
    r"(facebook|twitter|x\.com|linkedin|pinterest|instagram|whatsapp|telegram\.me|t\.me/share|vk\.com/share|"
    r"reddit|tumblr|mailto:|doubleclick|googleadservices|amazon\.[a-z.]+/|bit\.ly|addtoany|sharethis|"
    r"gravatar|wp\.me|feedburner|youtube\.com/(channel|user|@)|apple\.com/app|play\.google)", re.I)


def outbound_links(html: str, base: str) -> list[dict]:
    """Внешние ссылки из тела статьи: адрес, текст ссылки и фраза вокруг.

    Тело — тот элемент, где больше всего абзацев (article, .entry-content, main…):
    меню, подвал и кнопки «поделиться» в него не входят.
    """
    soup = BeautifulSoup(html, "lxml")
    candidates = soup.select("article, .entry-content, .post-content, .article-body, .article__body, main") or [soup]
    body = max(candidates, key=lambda el: len(el.find_all("p")))
    host = urlsplit(base).netloc.removeprefix("www.")
    found: dict[str, dict] = {}
    for a in body.find_all("a", href=True):
        url = urljoin(base, a["href"])
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or NOT_SOURCES.search(url):
            continue
        domain = parts.netloc.removeprefix("www.")
        # Свой сайт и его поддомены (register.aecmag.com) — не внешняя ссылка.
        if domain == host or domain.endswith("." + ".".join(host.split(".")[-2:])):
            continue
        context = a.find_parent(["p", "li", "figcaption"])
        found.setdefault(url, {
            "url": url, "domain": parts.netloc.removeprefix("www."),
            "text": a.get_text(" ", strip=True)[:120],
            "context": (context.get_text(" ", strip=True) if context else "")[:240],
        })
    return list(found.values())[:40]


def _images_from_html(html: str, base: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    images: list[dict] = []
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        images.append({"url": urljoin(base, og["content"]), "caption": None, "credit": None, "from": "og:image"})
    for fig in soup.find_all("figure", limit=30):
        img = fig.find("img")
        if not img:
            continue
        src = img.get("data-src") or img.get("src")
        srcset = img.get("srcset") or img.get("data-srcset")
        if srcset:
            # Самый крупный вариант из srcset.
            best = max((p.strip().split(" ") for p in srcset.split(",") if p.strip()),
                       key=lambda p: int(re.sub(r"\D", "", p[1]) or 0) if len(p) > 1 else 0)
            src = best[0]
        if not src or src.startswith("data:"):
            continue
        cap_el = fig.find("figcaption")
        caption = cap_el.get_text(" ", strip=True) if cap_el else (img.get("alt") or None)
        credit = None
        if caption and CREDIT.search(caption):
            credit = caption[CREDIT.search(caption).start():].strip()
        images.append({"url": urljoin(base, src), "caption": caption, "credit": credit, "from": "figure"})
    seen, unique = set(), []
    for im in images:
        key = re.sub(r"[-_]\d{2,4}x\d{2,4}(?=\.\w+$)", "", im["url"])
        if key not in seen:
            seen.add(key)
            unique.append(im)
    return unique[:12]


def _general_credit(text: str) -> str | None:
    m = GENERAL_CREDIT.search(text or "")
    return m.group(0).strip() if m else None


def _wordpress(fetcher: Fetcher, url: str) -> tuple[str, str] | None:
    parts = urlsplit(url)
    slug = [p for p in parts.path.split("/") if p]
    if not slug:
        return None
    api = f"{parts.scheme}://{parts.netloc}/wp-json/wp/v2/posts?slug={slug[-1]}&_fields=content,title"
    try:
        r = fetcher.get(api)
        posts = json.loads(r.content.decode("utf-8", "replace"))
        if posts:
            return posts[0]["content"]["rendered"], api
    except (FetchError, ValueError, KeyError, TypeError):
        return None
    return None


def fetch_article(fetcher: Fetcher, item: Item, full_text_in_feed: bool) -> dict:
    """Текст, фото и откуда они взяты. Ошибки не прерывают цепочку — они в warnings."""
    warnings: list[str] = []
    html, origin = None, None
    if full_text_in_feed and item.content_html and len(html_text(item.content_html)) > MIN_TEXT:
        html, origin = item.content_html, "лента"
    if html is None:
        try:
            r = fetcher.get(item.url)
            html, origin = r.content.decode(_charset(r.headers), "replace"), "страница"
        except FetchError as e:
            warnings.append(f"страница не получена ({e.reason})")
    text = ""
    if html is not None:
        text = trafilatura.extract(html, include_comments=False, include_tables=False, favor_recall=True) or ""
        if len(text) < MIN_TEXT and origin == "страница":
            warnings.append("на странице мало текста")
    if len(text) < MIN_TEXT:
        wp = _wordpress(fetcher, item.url)
        if wp:
            html, origin = wp[0], "WordPress API"
            text = html_text(html)
    if len(text) < MIN_TEXT and item.content_html:
        html, origin = item.content_html, "лента"
        text = html_text(item.content_html)
    if len(text) < MIN_TEXT:
        text = item.summary
        origin = "описание из ленты"
        warnings.append("полного текста нет — работаем по описанию из ленты")
    images = _images_from_html(html, item.url) if html else []
    if not images:
        images = [{"url": i["url"], "caption": i.get("caption"), "credit": None, "from": "лента"} for i in item.images]
    general = _general_credit(text) or (_general_credit(html_text(html)) if html else None)
    for im in images:
        if not im["credit"] and general:
            im["credit"] = general
            im["credit_note"] = "общая строка статьи"
    links = outbound_links(html, item.url) if html else []
    return {"text": text[:20000], "text_origin": origin, "images": images, "links": links, "warnings": warnings}


def _charset(headers: dict[str, str]) -> str:
    m = re.search(r"charset=([\w-]+)", headers.get("content-type", ""), re.I)
    return m.group(1) if m else "utf-8"
