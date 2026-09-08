# AI Web Data Runtime — implementation contract

Local-first extension of Hero Browser. Existing profiles, partitions and login storage are not migrated or cleared.

## Delivery
1. SQLite acquisition store: jobs/runs, sanitized page snapshots, structured records, provenance, full-text index.
2. Schema extraction with nested field paths, CSS mappings, primitive validation and explicit missing-field errors.
3. Bounded job workflow (navigate/click/type/scroll/wait/extract/human), run/pause/resume/cancel, persistent schedules while app runs.
4. Opt-in recorder for actual manual navigation/click/type/scroll. Sensitive inputs are omitted; recording is bound to one tab/profile. Review/edit recorded steps before creating a job.
5. Snapshot diffs, numeric delta/percent, historical entity/topic timelines and baseline anomaly statistics.
6. Dataset versions with cleaning, exact/near dedup, heuristic language/quality/spam metrics, default PII redaction, chunks and provenance; JSON/JSONL/CSV/Parquet exports.
7. Entity candidates with evidence/confidence and explicit reviewed linking; public mention/link/hashtag graph.
8. SQLite FTS5 search and optional agent-supplied embedding vectors with model/dimension checks.
9. Data workspace UI and typed MCP tools.

## Boundaries
Schedules run only while app is open, are deferred when another profile is active or session is locked, and never overlap. Runs interrupted by restart remain paused for explicit resumption. Job tabs belong to the job; normal user tabs are preserved. Limits: 100 targets, 100 steps, 200 rows/extraction, 10,000 records/dataset build.

No provider key or external AI service is assumed. CSS mappings come from a human or MCP agent. Language, sentiment, spam and anomaly scores are labeled heuristic, not model confidence. Vector queries require embeddings supplied by the agent; no fabricated semantic vectors.

## Acceptance
Unit fixtures validate normalization/PII, schemas, diff identity, immutable versions, FTS and export roundtrip. Electron fixtures exercise recorder, replay, pause/cancel, schedule decisions, snapshots, dataset/search and restart. Existing persistence/sharing tests must remain green.

## Build
node scripts/build.cjs
node --test tests/*.test.cjs
npm run test:e2e

## Structure
src/shared/data-contracts.ts: validated API and types.
src/main/data/: store, processing, browser extraction/recorder, dataset/analytics, job runtime.
src/renderer/data-workspace.ts: local workspace UI.
tests/data*.cjs: synthetic data only.
