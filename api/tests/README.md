# Интеграционные проверки

`linkCitations.integration.ts` запускается `deno run -A tests/linkCitations.integration.ts` из api с его deno.json и окружением API. Требует восстановленную отдельную БД `codex_citations_0061`; при другом имени останавливается. Создаёт тестовые сущности/связи и изменяет один старый документ обоснования только в этой копии. Не запускать против рабочей БД. Результаты и HTML карточки пишет в /tmp.

classification.integration.ts требует отдельной восстановленной codex_classification_0062 с миграцией 0062. Проверяет наполнение/имена/цитаты/принятие/повторы/конфликты/сохранность. Внешний LLM заменён локальным ответом, платных вызовов нет.


sourceText.test.ts: `deno run -A tests/sourceText.test.ts` — 30 локальных проверок адресов, DNS, извлечения, качества, коротких языковых запросов и HTTP framing, без LLM.

fulltextLive.integration.ts: только восстановленная БД codex_fulltext_0062 и явное ALLOW_LIVE_RESEARCH_TEST=yes. Повторяет проверки библиотеки/связей, читает /tmp/live-texts.json (массив результатов retrieveText реальных страниц, включая Arquitectura Viva), делает один платный вызов LLM, принимает предложение через preview/accept и проверяет неизменность прежних версий. Запуск: `deno run -A tests/fulltextLive.integration.ts`. Не запускать против рабочей БД.

researchBudget.test.ts: `deno run --config api/deno.json api/tests/researchBudget.test.ts` из корня repo; 216 проверок без БД/сети/LLM. researchBatch.integration.ts требует восстановленную codex_researchfix_0062, проверяет пакет нескольких цитат в одну связь, повторы и конфликты; LLM замокан, платных вызовов нет.
