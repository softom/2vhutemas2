"""Check the built standalone entry over HTTP. Run after npm run build."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

dist = Path(__file__).resolve().parents[1] / "dist"
handler = partial(SimpleHTTPRequestHandler, directory=str(dist))
with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/games/stili.html"
    with urlopen(url) as response:
        assert response.status == 200 and response.url == url
        assert 'data-react-widget="style_quiz"' in response.read().decode()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("https://mc.yandex.ru/**", lambda route: route.abort())
        page.route("**/api/v1/entities/*", lambda route: route.fulfill(json={
            "title_ru": "Здание " + route.request.url.split("/")[-1], "media": []
        }))
        result = page.goto(url)
        assert result.status == 200 and page.url == url
        widget = page.locator('[data-react-widget="style_quiz"]')
        expect(widget.get_by_text("Здание 1 из 34 · Верно: 0")).to_be_visible()
        expect(widget.locator(".quiz-options button")).to_have_count(17)
        widget.locator(".quiz-options button").first.click()
        widget.get_by_role("button", name="Дальше").click()
        expect(widget.get_by_text("Здание 2 из 34", exact=False)).to_be_visible()
        assert page.url == url and not errors, errors
        browser.close()
    server.shutdown()
print("HTTP 200, same URL, 17 answers, second round reached")
