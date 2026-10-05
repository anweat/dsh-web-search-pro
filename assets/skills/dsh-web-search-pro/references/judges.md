# Judge providers and rubrics

In evidence mode, passages are scored per need. By default a local lexical scorer decides (free, offline, cross-language aware). An optional model judge can re-score; it is configured in settings, never by the model.

- `evidence.jevMode` / `evidence.judge.mode`: `off` (default; nothing is sent), `shadow` (the rule scorer decides, the model's scores are only recorded for comparison), `control` (the model decides when `scorer: jev`; any failure falls back to the rules and says so in `notes`), `hybrid` (rules score everything; the model re-scores only (need, block) pairs whose languages differ, plus borderline ones with `hybridBorderline`).
- What a model judge receives: the one-sentence task, the need text and the page block text. Nothing else.
- Providers (`evidence.judge.provider`): `bocha-jev` (default), `typesafe-jev`, `laya-local`, `jina-rerank`, `cohere-rerank`, or your own under `evidence.judge.providers`. A rerank provider needs a `calibration` (monotone `[raw score, grade 0..3]` points) or it is not used.
- Caps: `evidence.budget.perSearchInputTokens` (default 60000) and `dailyInputTokens` (default 1000000); over a cap the model stage is skipped and the notes say "model budget exceeded".
- Rubrics (`score.support`, `gate.relevance`, `gate.constraint`) are versioned prompts. An override under `evidence.rubrics.<id>` needs a new `version`; an invalid one is ignored and the reason appears in `sources.status` (`evidence.diagnostics`). Only the user edits them.

To see what is in force: `sources.status` -> `evidence` (mode, who decides, provider usability, today's usage, active rubric `id@version #hash`). If a judge key is missing, `decides` reads `rule` with a note, and results are still valid, just rule-scored.
