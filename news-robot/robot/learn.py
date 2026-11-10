"""Обучение ранжирования на выборе редактора и его оценке доводов робота (Р-93, 2026-11-07).

Редактор оценивает не просто тему новости («да» / «нет»), но и **доводы робота** (claims):
почему робот поставил претендента в список и какие у робота были сомнения.

Доводы делятся на два рода:
1. Доводы вкуса (пишет LLM: arch_value — ценность для архитектора, novelty — новизна метода,
   doubt — сомнение по сути). Подтверждённые и опровергнутые доводы вкуса идут в примеры
   промпта train и в калибровку профиля вкуса (calibrate.md).
2. Доводы момента (считает робот: freshness — свежесть, resonance — число изданий,
   students — участие студентов, saturation — насыщение темы по векторам).
   Решения, принятые только по причинам момента (например, «уже была такая тема» или «старое»),
   не искажают профиль вкуса и поправки рубрик, а управляют 21-дневным векторным штрафом
   насыщения и весами свежести/резонанса.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .editorial import category_of, section_profile
from . import category_prompts
from .llm import LLM, LLMError, prompt

MAX_ADJUST = 6           # поправка вида или темы — не больше ±6 баллов, чтобы не глушить целые рубрики
MIN_GROUP = 4            # группа меньше — поправку не считаем
PRIOR = 6                # сглаживание к средней доле
SATURATION_DAYS = 21     # сколько дней действует затухающий штраф «уже была такая тема»
SATURATION_SIM = 0.66    # порог косинусного сходства векторов для близких по теме историй

CLAIM_LABELS = {
    "arch_value": "ценность для архитектора",
    "novelty": "новизна метода / идеи",
    "freshness": "свежесть",
    "resonance": "резонанс в изданиях",
    "students": "для студентов",
    "saturation": "насыщение темы",
    "doubt": "сомнение по сути",
}
TASTE_KINDS = {"arch_value", "novelty", "doubt"}
MOMENT_KINDS = {"freshness", "resonance", "students", "saturation"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        s = str(ts).strip()
        if len(s) == 10:
            s += "T00:00:00+00:00"
        elif s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── Повторение истории в разных изданиях ─────────────────────────────────────

def track_stories(state, candidates: list[dict], days: int = 7) -> None:
    """Копит издания каждой истории между прогонами: новость, которую через день
    подхватили ещё три издания, весит больше, чем в первом прогоне."""
    stories = state.data.setdefault("stories", {})
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    for key in [k for k, v in stories.items() if v.get("last_seen", "") < cutoff]:
        del stories[key]
    for c in candidates:
        st = stories.setdefault(c["story_key"], {"first_seen": now(), "sources": []})
        st["sources"] = sorted(set(st["sources"]) | {s["source"] for s in c["sources"]})
        st["last_seen"] = now()
        c["sources_total"] = len(st["sources"])


# ── Векторное насыщение темы («Уже была такая тема») ─────────────────────────

def _cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def saturation_info(story_key: str, state, root: Path | None = None, vec_store: dict | None = None) -> dict:
    """Проверяет по векторам (.state/story_vectors.json), сколько близких историй было за 14–21 день
    и сколько из них редактор отклонил или пометил «уже была такая тема»."""
    if vec_store is None and root is not None:
        vf = root / ".state" / "story_vectors.json"
        if vf.exists():
            try:
                vec_store = json.loads(vf.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                vec_store = {}
    stories_vecs = (vec_store or {}).get("stories") or {}
    me = stories_vecs.get(story_key)
    if not me or not me.get("vec"):
        return {"similar_14d": 0, "rejected_similar": 0, "saturated_hits": 0, "penalty": 0, "examples": []}

    my_vec = me["vec"]
    now_dt = datetime.now(timezone.utc)
    cutoff_14d = now_dt - timedelta(days=14)
    cutoff_sat = now_dt - timedelta(days=SATURATION_DAYS)

    judgments_map = (state.data.get("judgments") or {}) if state is not None else {}
    sat_map = (state.data.get("saturated_topics") or {}) if state is not None else {}

    similar_14d = 0
    rejected_similar = 0
    saturated_hits = 0
    max_sat_weight = 0.0
    examples: list[str] = []

    for other_key, info in stories_vecs.items():
        if other_key == story_key or not info.get("vec"):
            continue
        seen_dt = _parse_iso(info.get("last_seen") or info.get("first_seen"))
        if seen_dt and seen_dt < cutoff_sat:
            continue
        sim = _cos(my_vec, info["vec"])
        if sim < SATURATION_SIM:
            continue
        j = judgments_map.get(other_key)
        # Если это уже выбранная («да») более старая история или отклонённая история
        if seen_dt is None or seen_dt >= cutoff_14d:
            similar_14d += 1
            if len(examples) < 3 and info.get("title"):
                examples.append(str(info["title"])[:65])
        if j and j.get("verdict") == "no":
            rejected_similar += 1
            j_dt = _parse_iso(j.get("at")) or seen_dt or now_dt
            age_days = max(0.0, (now_dt - j_dt).total_seconds() / 86400.0)
            if age_days <= SATURATION_DAYS:
                decay = max(0.0, 1.0 - age_days / SATURATION_DAYS)
                if j.get("saturated") or other_key in sat_map:
                    saturated_hits += 1
                    max_sat_weight = max(max_sat_weight, sim * decay * 1.35)
                else:
                    max_sat_weight = max(max_sat_weight, sim * decay * 0.75)

    # Штраф насыщения: включается, если редактор явно отметил «уже была такая тема» на близкой истории
    # или если накопилось >= 3 отказов по близким историям за 2 недели.
    penalty = 0
    if saturated_hits >= 1 or rejected_similar >= 3:
        raw_pen = max_sat_weight * 14.0 + min(rejected_similar, 5) * 2.5 + min(saturated_hits, 3) * 4.0
        penalty = min(25, max(4, round(raw_pen)))

    return {
        "similar_14d": similar_14d,
        "rejected_similar": rejected_similar,
        "saturated_hits": saturated_hits,
        "penalty": penalty,
        "examples": examples,
    }


# ── Решения редактора ────────────────────────────────────────────────────────

def _normalize_claims(cand_claims: list[dict], claims_verdicts: list[dict] | dict | None,
                      verdict: str, saturated: bool, moment_reason: str | None) -> list[dict]:
    """Собирает итоговый список доводов истории с отметками редактора (true / false)."""
    by_id: dict[str, str] = {}
    extra_claims: list[dict] = []
    if isinstance(claims_verdicts, dict):
        for k, v in claims_verdicts.items():
            if v in ("true", "false", True, False):
                by_id[str(k)] = "true" if v in ("true", True) else "false"
    elif isinstance(claims_verdicts, list):
        for item in claims_verdicts:
            if not isinstance(item, dict):
                continue
            cid = str(item.get("id") or item.get("kind") or "")
            v = item.get("verdict")
            if cid and v in ("true", "false", True, False):
                by_id[cid] = "true" if v in ("true", True) else "false"
            if item.get("text") and cid and not any(c.get("id") == cid for c in cand_claims):
                extra_claims.append(item)

    all_claims = [dict(c) for c in (cand_claims or [])] + extra_claims
    result: list[dict] = []
    for idx, c in enumerate(all_claims):
        cid = str(c.get("id") or f"{c.get('kind', 'claim')}_{idx}")
        kind = str(c.get("kind") or "arch_value")
        pole = str(c.get("pole") or ("doubt" if kind in ("doubt", "saturation") else "for"))
        cv = by_id.get(cid) or by_id.get(kind)

        if cv is None:
            if saturated or moment_reason == "saturated":
                if kind == "saturation":
                    cv = "true"
                elif kind == "novelty":
                    cv = "false"
            elif moment_reason == "stale" and kind == "freshness":
                cv = "false" if pole == "for" else "true"
            elif moment_reason in ("not_arch", "weak_arch") and kind in ("arch_value", "novelty") and pole == "for":
                cv = "false"

        rec = {
            "id": cid,
            "kind": kind,
            "pole": pole,
            "by": c.get("by") or ("robot" if kind in MOMENT_KINDS else "llm"),
            "text": str(c.get("text") or "")[:240],
            "verdict": cv,  # "true", "false" или None
        }
        result.append(rec)

    # Если редактор нажал «Уже была такая тема», а сомнения saturation в списке ещё не было — добавим его
    if (saturated or moment_reason == "saturated") and not any(r["kind"] == "saturation" for r in result):
        result.append({
            "id": "saturation",
            "kind": "saturation",
            "pole": "doubt",
            "by": "robot",
            "text": "Уже была такая тема в ленте",
            "verdict": "true",
        })
    return result


def record(state, run_summary: dict | None, story_key: str, verdict: str, by: str | None, note: str | None,
           claims_verdicts: list[dict] | dict | None = None, saturated: bool = False,
           moment_reason: str | None = None) -> dict:
    """Решение по истории с её признаками и проверенными доводами робота."""
    cand = next((c for c in (run_summary or {}).get("candidates", []) if c["story_key"] == story_key), {})
    if not cand and getattr(state, "path", None):
        pool_file = state.path.parent / "pool.json"
        if pool_file.exists():
            try:
                pdata = json.loads(pool_file.read_text(encoding="utf-8"))
                cand = next((c for c in (pdata.get("candidates") or []) if c.get("story_key") == story_key), {})
            except (OSError, json.JSONDecodeError):
                pass

    note_clean = (note or "").strip() or None
    if moment_reason == "saturated":
        saturated = True
    if note_clean and any(w in note_clean.lower() for w in ("уже была", "уже было", "повтор тем", "насыщ")):
        saturated = True

    cand_claims = cand.get("claims") or []
    if not cand_claims and cand.get("reason"):
        cand_claims = [{"id": "arch_value_0", "kind": "arch_value", "pole": "for", "by": "llm", "text": cand["reason"]}]

    norm_claims = _normalize_claims(cand_claims, claims_verdicts, verdict, saturated, moment_reason)
    if any(c["kind"] == "saturation" and c.get("verdict") == "true" for c in norm_claims):
        saturated = True

    # Определяем, является ли отказ чисто моментным (насыщение темы или давность), без опровержения вкуса
    taste_refuted = any(
        (c["kind"] == "arch_value" and c.get("verdict") == "false")
        or (c["kind"] == "novelty" and c.get("verdict") == "false" and not saturated)
        or (c["kind"] == "doubt" and c.get("verdict") == "true")
        for c in norm_claims
    )
    moment_only = bool(
        verdict == "no"
        and (saturated or moment_reason in ("saturated", "stale"))
        and not taste_refuted
    )

    j = {
        "story_key": story_key,
        "verdict": verdict,
        "by": by,
        "note": note_clean,
        "at": now(),
        "title": cand.get("title_ru") or cand.get("title"),
        "topic": cand.get("topic"),
        "category": category_of(cand),
        "kind": cand.get("kind"),
        "interest": cand.get("interest"),
        "final": cand.get("final"),
        "sources": cand.get("sources_total") or len(cand.get("sources", [])) or None,
        "competition": cand.get("competition"),
        "students_eligible": cand.get("students_eligible"),
        "reason": cand.get("reason"),
        "run_id": (run_summary or {}).get("id") or cand.get("run_id"),
        "claims": norm_claims,
        "saturated": saturated,
        "moment_reason": moment_reason,
        "moment_only": moment_only,
    }
    judgments_map = state.data.setdefault("judgments", {})
    judgments_map[story_key] = j

    sat_topics = state.data.setdefault("saturated_topics", {})
    if saturated and verdict == "no":
        sat_topics[story_key] = {
            "at": j["at"],
            "title": j["title"] or story_key,
            "topic": j["topic"],
            "kind": j["kind"],
        }
    elif verdict == "yes" and story_key in sat_topics:
        del sat_topics[story_key]

    return j


def judgments(state) -> list[dict]:
    return list(state.data.get("judgments", {}).values())


# ── Калибровка: статистика доводов и весов ───────────────────────────────────

def _rate(items: list[dict]) -> float:
    return sum(1 for j in items if j["verdict"] == "yes") / len(items) if items else 0.0


def claim_stats(items: list[dict], state=None) -> dict:
    """Точность робота по видам доводов: сколько раз редактор подтвердил (true) или опроверг (false) каждый вид довода."""
    by_kind: dict[str, dict] = {
        k: {"label": label, "pole": "doubt" if k in ("doubt", "saturation") else "for",
            "by": "robot" if k in MOMENT_KINDS else "llm",
            "confirmed": 0, "refuted": 0, "total": 0, "accuracy": None}
        for k, label in CLAIM_LABELS.items()
    }
    judged_with_claims = 0
    moment_only_count = 0
    for j in items:
        if j.get("moment_only"):
            moment_only_count += 1
        cl_list = j.get("claims") or []
        if any(c.get("verdict") in ("true", "false") for c in cl_list):
            judged_with_claims += 1
        for c in cl_list:
            v = c.get("verdict")
            if v not in ("true", "false"):
                continue
            k = c.get("kind") or "arch_value"
            if k not in by_kind:
                by_kind[k] = {"label": k, "pole": c.get("pole") or "for", "by": c.get("by") or "llm",
                              "confirmed": 0, "refuted": 0, "total": 0, "accuracy": None}
            if v == "true":
                by_kind[k]["confirmed"] += 1
            else:
                by_kind[k]["refuted"] += 1
            by_kind[k]["total"] += 1

    for rec in by_kind.values():
        if rec["total"] > 0:
            rec["accuracy"] = round(rec["confirmed"] / rec["total"], 3)

    sat_topics = (state.data.get("saturated_topics") or {}) if state is not None else {}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=SATURATION_DAYS)).isoformat()
    active_sat = [
        {"story_key": k, **v}
        for k, v in sat_topics.items()
        if (v.get("at") or "") >= cutoff
    ]
    active_sat.sort(key=lambda x: x.get("at") or "", reverse=True)

    return {
        "judged_with_claims": judged_with_claims,
        "moment_only_count": moment_only_count,
        "saturated_active_count": len(active_sat),
        "saturated_active": active_sat[:15],
        "by_kind": by_kind,
    }


def adjustments(items: list[dict], state=None) -> dict:
    """Поправки ранжирования по решениям: вид, тема, вес повторения в изданиях, плюс статистика доводов.
    Решения только по причинам момента (moment_only: «уже была такая тема», «старое») не занижают тему и вид."""
    taste_items = [j for j in items if (j.get("kind") or j.get("topic")) and not j.get("moment_only")]
    base = _rate(taste_items)
    cstats = claim_stats(items, state)
    result: dict = {
        "base_rate": round(base, 3),
        "n": len(taste_items),
        "n_total": len(items),
        "kind": {},
        "topic": {},
        "claims": cstats,
    }
    for field in ("kind", "topic"):
        groups = defaultdict(list)
        for j in taste_items:
            if j.get(field):
                groups[j[field]].append(j)
        for name, group in groups.items():
            if len(group) < MIN_GROUP:
                continue
            smoothed = (sum(1 for j in group if j["verdict"] == "yes") + PRIOR * base) / (len(group) + PRIOR)
            result[field][name] = max(-MAX_ADJUST, min(MAX_ADJUST, round((smoothed - base) * 60)))
    by_sources = defaultdict(list)
    for j in taste_items:
        if j.get("sources"):
            by_sources[min(int(j["sources"]), 4)].append(j)
    one, many = by_sources.get(1, []), [j for k, v in by_sources.items() if k >= 2 for j in v]
    if len(one) >= MIN_GROUP and len(many) >= MIN_GROUP:
        lift = _rate(many) - _rate(one)
        result["per_extra_source"] = max(0, min(10, round(4 + lift * 20)))
    return result


def agreement(items: list[dict], top: int = 3) -> dict:
    """Совпадение с редактором: из top лучших историй каждого прогона — сколько выбрано."""
    by_run = defaultdict(list)
    for j in items:
        if j.get("run_id") and j.get("final") is not None:
            by_run[j["run_id"]].append(j)
    hits = total = 0
    for group in by_run.values():
        best = sorted(group, key=lambda j: j["final"], reverse=True)[:top]
        hits += sum(1 for j in best if j["verdict"] == "yes")
        total += len(best)
    yes = [j for j in items if j["verdict"] == "yes"]
    return {"top": top, "runs": len(by_run), "hits": hits, "total": total,
            "precision": round(hits / total, 3) if total else None, "chosen": len(yes), "judged": len(items)}


# ── Калибровка: профиль вкуса через LLM ──────────────────────────────────────

def format_claim_feedback(j: dict) -> dict[str, list[str]]:
    """Возвращает подтверждённые и опровергнутые доводы для записи решения."""
    confirmed: list[str] = []
    refuted: list[str] = []
    for c in j.get("claims") or []:
        v = c.get("verdict")
        txt = (c.get("text") or "").strip()
        if not txt or v not in ("true", "false"):
            continue
        pole = c.get("pole") or "for"
        if pole == "for":
            if v == "true":
                confirmed.append(txt)
            else:
                refuted.append(txt)
        else:  # doubt
            if v == "true":
                refuted.append(f"сомнение подтвердилось: {txt}")
            else:
                confirmed.append(f"сомнение напрасно: {txt}")
    return {"confirmed": confirmed, "refuted": refuted}


def profile(llm: LLM, items: list[dict], seed: dict, current: str | None) -> dict:
    lines = []
    for j in sorted(items, key=lambda j: j["at"])[-120:]:
        fb = format_claim_feedback(j)
        rec = {
            "выбор": "ДА" if j["verdict"] == "yes" else "НЕТ",
            "заголовок": j.get("title") or j["story_key"],
            "тема": j.get("topic"),
            "вид": j.get("kind"),
            "изданий": j.get("sources"),
            "оценка робота": j.get("interest"),
            "довод робота": j.get("reason"),
            "пояснение редактора": j.get("note"),
            "категория": j.get("category") or category_of(j),
        }
        if fb["confirmed"]:
            rec["верные доводы"] = fb["confirmed"]
        if fb["refuted"]:
            rec["опровергнутые доводы"] = fb["refuted"]
        if j.get("saturated"):
            rec["причина момента"] = "уже была такая тема (насыщение)"
        elif j.get("moment_only") and j.get("moment_reason") == "stale":
            rec["причина момента"] = "старое / опоздали"
        lines.append(rec)
    for t in seed.get("chosen", []):
        lines.append({"выбор": "ДА", "заголовок": t, "из": "первый блок"})
    for t in seed.get("rejected", []):
        lines.append({"выбор": "НЕТ", "заголовок": t, "из": "первый блок"})
    category = category_of(items[0]) if items else "unclassified"
    if category not in category_prompts.NAMES:
        return {"profile_text": current or ""}
    system = ("Уточни критерии редактора только для категории «" + category_prompts.NAMES[category] + "». "
              "Не переноси причины момента (старое/повтор) в постоянный вкус. Неоценённые доводы не подтверждены. "
              "Сохрани прежние правила без новых свидетельств. Верни JSON {\"profile_text\":\"правила только этой категории\"}. "
              "Текущие правила: " + category_prompts.sections(current or "").get(category_prompts.NAMES[category], ""))
    return llm.chat_json("calibrate-" + category, system, json.dumps(lines, ensure_ascii=False), max_tokens=4000)



def _auc(pairs: list[tuple[float, bool]]) -> float | None:
    pos = [s for s, y in pairs if y]
    neg = [s for s, y in pairs if not y]
    if not pos or not neg:
        return None
    return sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg) / (len(pos) * len(neg))


def score_with(llm: LLM, profile_text: str, train: list[dict], test: list[dict]) -> float | None:
    """Совпадение с редактором на отложенных решениях вкуса при данном профиле (AUC)."""
    got = {}
    eval_test = [j for j in test if not j.get("moment_only")]
    for category in category_prompts.NAMES:
        group = [(i,j) for i,j in enumerate(eval_test) if category_of(j) == category]
        if not group: continue
        examples = json.dumps([j for j in train[-40:] if category_of(j) == category and not j.get("moment_only")], ensure_ascii=False)
        payload = [{"id":str(i),"title":j.get("title") or j["story_key"],"summary":j.get("reason") or ""} for i,j in group]
        system = category_prompts.render(category_prompts.template_for(None,category),profile_text,examples,category)
        resp = llm.chat_json("validate-"+category,system,json.dumps(payload,ensure_ascii=False),max_tokens=16000)
        for r in resp.get("items",[]):
            if str(r.get("id","")).isdigit(): got[int(r["id"])]=float(r.get("interest") or 0)
    if len(got) != len(eval_test): return None
    return _auc([(got[i],j["verdict"]=="yes") for i,j in enumerate(eval_test)])



def _calibrate_one(state, llm: LLM | None, seed: dict, log, force: bool = False, min_new: int = 15,
              default_profile: str = "") -> dict | None:
    """Пересчитать поправки и профиль, если накопилось min_new новых решений (или force)."""
    items = judgments(state)
    learned = state.data.setdefault("learned", {"history": []})
    new = len(items) - learned.get("judged_at_calibration", 0)
    if not force and new < min_new:
        return None
    before = agreement(items)
    adj = adjustments(items, state)
    entry = {"at": now(), "judged": len(items), "adjustments": adj, "agreement": before}
    if llm is not None and llm.live:
        ordered = sorted(items, key=lambda j: j["at"])
        taste_ordered = [j for j in ordered if not j.get("moment_only")]
        test = [j for idx, j in enumerate(taste_ordered) if idx % 5 == 4][-24:]
        test_keys = {j["story_key"] for j in test}
        train = [j for j in taste_ordered if j["story_key"] not in test_keys]
        current = learned.get("profile_text") or default_profile
        try:
            prof = profile(llm, train, seed, current)
            if train and prof.get("profile_text"):
                cat = category_of(train[0])
                prof["profile_text"] = category_prompts.replace_profile(current, cat, prof["profile_text"])
            entry["profile"] = prof
            if train and len({j["verdict"] for j in test}) == 2:
                old_auc = score_with(llm, current, train, test)
                new_auc = score_with(llm, prof.get("profile_text") or current, train, test)
                entry["validation"] = {"held_out": len(test), "auc_old": old_auc, "auc_new": new_auc}
                accepted = force or (new_auc is not None and (old_auc is None or new_auc >= old_auc - 0.03))
            else:
                accepted = bool(force and prof.get("profile_text"))
                entry["validation"] = {"held_out": len(test), "note": "мало решений для проверки — профиль не принят"}
            entry["accepted"] = accepted
            if accepted:
                learned["profile_text"] = section_profile(prof.get("profile_text") or current)
                learned["profile"] = prof
            log("info", "learn", "профиль вкуса", accepted=accepted, **{k: v for k, v in entry["validation"].items()
                                                                          if k != "note"})
        except LLMError as e:
            log("warn", "learn", "профиль не обновлён", error=str(e))
    learned["adjustments"] = adj
    learned["judged_at_calibration"] = len(items)
    learned["history"] = (learned["history"] + [entry])[-30:]
    log("info", "learn", "калибровка", judged=len(items), precision=before["precision"],
        kinds=len(adj["kind"]), topics=len(adj["topic"]))
    return entry


def calibrate(state, llm, seed, log, force=False, min_new=15, default_profile="", category=None):
    from types import SimpleNamespace
    import copy
    learned = state.data.setdefault("learned", {"history": []})
    histories = learned.setdefault("category_learning", {})
    current = learned.get("profile_text") or default_profile
    entries = {}
    for code in category_prompts.NAMES:
        if category and category != code: continue
        group = {key:j for key,j in state.data.get("judgments",{}).items() if category_of(j)==code}
        if not group: continue
        local = copy.deepcopy(histories.get(code) or {"history": []})
        local["profile_text"] = category_prompts.scoped_profile(current, code)
        isolated = SimpleNamespace(data={"judgments":group,"learned":local,"saturated_topics":{}})
        entry = _calibrate_one(isolated,llm,{},log,force,min_new,local["profile_text"])
        if entry is None: continue
        histories[code]=local;entries[code]=entry
        if entry.get("accepted"):
            body=category_prompts.sections(local["profile_text"]).get(category_prompts.NAMES[code], "")
            current=category_prompts.replace_profile(current,code,body)
    if not entries: return None
    learned["profile_text"]=current
    learned["adjustments"]=adjustments(judgments(state),state)
    learned["judged_at_calibration"]=len(judgments(state))
    result={"at":now(),"categories":entries,"judged":len(judgments(state)),"profile":{"profile_text":current}}
    learned["history"]=(learned.get("history",[])+[result])[-30:]
    return result


def apply(c: dict, learned: dict) -> int:
    """Поправка к оценке истории по выученному: вид и тема."""
    adj = learned.get("adjustments") or {}
    return int((adj.get("kind") or {}).get(c.get("kind"), 0)) + int((adj.get("topic") or {}).get(c.get("topic"), 0))
