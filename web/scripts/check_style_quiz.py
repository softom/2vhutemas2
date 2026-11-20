"""Run after bundling scripts/styleQuiz.check.ts as .cache/styleQuiz.check.js (global QuizTest)."""
from pathlib import Path
import json
import hashlib
from playwright.sync_api import expect, sync_playwright

web = Path(__file__).resolve().parents[1]
data = json.loads((web / "src/styleQuiz.json").read_text("utf8"))
# Fingerprint of the original standalone exercises before §6.4.
assert hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest() == "5b283815be236d01142f60f3e6e836aea75922203ce80681594f7b5717d9b948"
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page()
    page.route("http://quiz.test/", lambda r: r.fulfill(content_type="text/html", body="<body></body>"))
    page.route("**/api/v1/entities/*", lambda r: r.fulfill(json={"title_ru":"Здание " + r.request.url.split("/")[-1], "media":[]}))
    page.goto("http://quiz.test/")
    page.evaluate("window.Deno = {env:{get:()=>undefined}}")
    page.add_script_tag(path=str(web / ".cache/styleQuiz.check.js"))
    page.evaluate("async () => {window.stopQuiz = await QuizTest.mountPair('7a96c005-e4c9-4e4d-995a-212a9b0c9e32')}")
    slot = page.locator("[data-layout-slot]")
    text = page.locator(".document-widget")
    def button(area, label):
        return area.get_by_role("button", name=label, exact=True)
    wrong = next(s["name"] for s in data["styles"] if s["name"] != data["buildings"][0]["style"])
    button(text, wrong).click()
    expect(text.get_by_text("Не совсем:", exact=False)).to_be_visible()
    for i,b in enumerate(data["buildings"]):
        expect(slot.get_by_text("Здание " + str(b["id"]),exact=False).last).to_be_visible()
        button(slot,b["style"]).click()
        expect(button(slot,b["style"])).to_be_disabled()
        button(slot,"Дальше" if i+1 < len(data["buildings"]) else "Итог").click()
    expect(slot.get_by_text("Итог: 34 из 34")).to_be_visible()
    expect(text.get_by_text("Здание 1 из 34 · Верно: 0")).to_be_visible()
    button(slot,"Сыграть ещё").click()
    expect(slot.get_by_text("Здание 1 из 34 · Верно: 0")).to_be_visible()
    expect(button(text,wrong)).to_be_disabled()
    page.evaluate("window.stopQuiz()")
    browser.close()
print("OK: original data, grid, document, independent score, 34 rounds, restart")
