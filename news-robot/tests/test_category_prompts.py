import json
import unittest
from types import SimpleNamespace
from robot import category_prompts as cp
from robot import learn

PROFILE="## Общие правила\nGENERAL\n\n## Архитектура\nARCH_ONLY\n\n## ПО\nSOFTWARE_ONLY\n\n## ИИ\nAI_ONLY\n\n## Конкурсы\nCONTEST_ONLY\n\n## Материалы сайта\nSITE_ONLY\n\n## Исследования и знания\nKNOWLEDGE_ONLY"
class FakeLLM:
    live=True
    def __init__(self): self.calls=[]
    def chat_json(self, stage, system, user, **kwargs):
        self.calls.append((stage,system,json.loads(user)))
        if stage.startswith("calibrate-"): return {"profile_text":"UPDATED_"+stage}
        if stage=="classify": return {"items":[{"id":p["id"],"category":"ai"} for p in json.loads(user)]}
        return {"items":[{"id":p["id"],"category":"bad-model-value","interest":80,"relevant":True} for p in json.loads(user)]}
class CategoryPromptTests(unittest.TestCase):
    def test_known_category_skips_classification_and_foreign_rules(self):
        llm=FakeLLM();state=SimpleNamespace(data={"judgments":{},"learned":{}})
        result=cp.evaluate(llm,[{"id":"one"}],state,PROFILE,known={"one":{"category":"architecture"}})
        self.assertEqual(len(llm.calls),1)
        system=llm.calls[0][1]
        self.assertIn("ARCH_ONLY",system);self.assertNotIn("AI_ONLY",system)
        self.assertNotIn("препринт",system)
        self.assertEqual(result["items"][0]["category"],"architecture")
    def test_mixed_batch_is_split(self):
        llm=FakeLLM();cp.evaluate(llm,[{"id":"one"},{"id":"two"}],None,PROFILE,known={"one":{"category":"architecture"},"two":{"category":"ai"}})
        self.assertEqual([c[0] for c in llm.calls],["triage-architecture","triage-ai"])
        self.assertEqual(llm.calls[0][2],[{"id":"one"}]);self.assertEqual(llm.calls[1][2],[{"id":"two"}])
    def test_unknown_is_classified_without_value_profile(self):
        llm=FakeLLM();cp.evaluate(llm,[{"id":"one"}],None,PROFILE)
        self.assertEqual(llm.calls[0][0],"classify")
        self.assertNotIn("GENERAL",llm.calls[0][1]);self.assertEqual(llm.calls[1][0],"triage-ai")
    def test_profile_edit_and_examples_are_scoped(self):
        changed=cp.replace_profile(PROFILE,"architecture","NEW")
        self.assertIn("AI_ONLY",changed);self.assertNotIn("ARCH_ONLY",changed)
        state=SimpleNamespace(data={"judgments":{"a":{"category":"architecture","title":"ARCH_EXAMPLE"},"b":{"category":"ai","title":"AI_EXAMPLE"}},"learned":{}})
        self.assertIn("ARCH_EXAMPLE",cp.build(state,PROFILE,"architecture"))
        self.assertNotIn("AI_EXAMPLE",cp.build(state,PROFILE,"architecture"))
    def test_category_body_cannot_overwrite_other_section(self):
        changed=cp.replace_profile(PROFILE,"architecture","## ИИ\nINJECTED")
        self.assertEqual(cp.sections(changed)["ИИ"],"AI_ONLY")
        self.assertIn("INJECTED",cp.sections(changed)["Архитектура"])
    def test_calibration_only_changes_requested_category(self):
        state=SimpleNamespace(data={"judgments":{"a":{"story_key":"a","category":"architecture","topic":"architecture","kind":"building","title":"A","verdict":"yes","at":"2026-01-01","interest":80,"final":80,"claims":[]}},"learned":{"history":[],"profile_text":PROFILE}})
        llm=FakeLLM();learn.calibrate(state,llm,{},lambda *a,**k:None,force=True,category="architecture")
        self.assertEqual([c[0] for c in llm.calls],["calibrate-architecture"])
        self.assertNotIn("AI_ONLY",llm.calls[0][1]);self.assertIn("AI_ONLY",state.data["learned"]["profile_text"])
        self.assertIn("UPDATED_calibrate-architecture",state.data["learned"]["profile_text"])
if __name__=="__main__":unittest.main()
