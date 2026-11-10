import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from robot.editorial import category_of, section_profile, LEGACY_SECTIONS
from robot.learn import _normalize_claims, record

class EditorialTests(unittest.TestCase):
    def test_legacy_profile_is_lossless_and_idempotent(self):
        original = "\n".join(LEGACY_SECTIONS) + "\nМоё правило без известной категории"
        result = section_profile(original)
        for line in original.splitlines():
            self.assertEqual(result.count(line), 1)
        self.assertEqual(section_profile(result), result)
        self.assertIn("## Материалы сайта", result)

    def test_category_precedence_and_no_guess_for_unknown(self):
        self.assertEqual(category_of(dict(topic="neurogeneration", kind="research")), "ai")
        self.assertEqual(category_of(dict(topic="neurogeneration", competition=True)), "competitions")
        self.assertEqual(category_of(dict(topic="architecture", kind="research")), "knowledge")
        self.assertEqual(category_of(dict(category="site", topic="architecture")), "site")
        self.assertEqual(category_of({}), "unclassified")

    def test_yes_does_not_confirm_unmarked_claims(self):
        claims = [dict(id="a", kind="arch_value", pole="for", text="Довод робота")]
        reason = dict(id="editor_architecture_value", kind="arch_value", pole="for", text="[Архитектура] Сильная идея", verdict="true")
        result = _normalize_claims(claims, [reason], "yes", False, None)
        self.assertIsNone(result[0]["verdict"])
        self.assertEqual(result[1]["verdict"], "true")
        self.assertEqual(result[1]["text"], reason["text"])

    def test_record_keeps_reason_and_category(self):
        from types import SimpleNamespace
        state = SimpleNamespace(data={})
        candidate = dict(story_key="test", category="knowledge", title_ru="Новая атрибуция", claims=[dict(id="a",kind="arch_value",pole="for",text="Довод")])
        reason = dict(id="editor_knowledge_value",kind="arch_value",pole="for",text="[Исследования и знания] Новый обоснованный вывод",verdict="true")
        j = record(state, {"id":"test-run","candidates":[candidate]}, "test", "yes", "editor", "Комментарий", [reason])
        self.assertEqual(j["category"], "knowledge")
        self.assertEqual(j["note"], "Комментарий")
        self.assertEqual(j["claims"][-1]["text"], reason["text"])
        self.assertIsNone(j["claims"][0]["verdict"])

    def test_staleness_is_not_a_taste_rejection(self):
        claims = [dict(id="a", kind="arch_value", pole="for", text="Идея"), dict(id="f", kind="freshness", pole="for", text="Свежая")]
        result = _normalize_claims(claims, [], "no", False, "stale")
        self.assertIsNone(result[0]["verdict"])
        self.assertEqual(result[1]["verdict"], "false")

if __name__ == "__main__": unittest.main()
