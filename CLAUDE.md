# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative rule set (commands, storage keys, security invariants) and is loaded automatically alongside this file. This file adds the architecture big picture; do not duplicate or contradict it.

## Commands

- `npm test` — the full custom Node suite (five `tests/*.test.mjs` files, chained). There is no single-test script or test framework; run one file directly with `node tests/quiz.test.mjs` (Node's TypeScript type stripping executes the `../src/*.ts` imports).
- `npm run typecheck` — `tsc --noEmit`; checks only `src/**/*.ts`, never the JS tests.
- `npx wrangler dev` (add `--env staging` for staging) — note the KV binding is `remote: true`, so local dev already touches remote KV.
- `npx wrangler deploy` (production) / `npx wrangler deploy --env staging`.
- `npm run db:schema:local[:staging]` — apply `schema.sql` to local D1.
- `npm run kv:usage[:staging]` — KV media quota report via `scripts/kv-media-usage.mjs`.
- No lint, formatter, build, or CI exists; do not invent one.

## Architecture

A single Hono Worker ("Gemini Edge Deployer") for teachers at an Indonesian school: paste quiz JSON produced by a Gemini "Gem", publish it as a self-contained student quiz page at `/p/<slug>`, with per-app media upload, server-side grading, item-analysis reports, print sheets, and manual essay grading.

### Runtime duality (the `.ts` import rule)

Modules are imported with explicit `.ts` extensions on purpose: Wrangler/esbuild bundles either way, but the Node-based tests import the same modules directly and Node ESM does not guess extensions. Consequence: anything a test imports (all of `src/quiz.ts`'s modules, `src/auth.ts`, `src/media.ts`, `src/media-gen.ts`) must not depend on Hono `Context` or Worker-only globals beyond `crypto.subtle`/`btoa` — keep core helpers pure and pass values in.

### Route layout

`src/index.ts` is wiring only: the bindings type, the two CORS layers (public student endpoints `/api/save|submit|media` at `origin: '*'`; admin endpoints allowlisted via `ALLOWED_ORIGINS`), and the mounting of every registrar. Each feature area registers itself onto the shared app via a registrar function, declaring the minimal binding type it needs:

- `src/media-routes.ts` — `/p/:slug/media` panel and `/media/:slug/:name` serving; storage falls back to KV when the optional R2 `MEDIA` binding is absent.
- `src/quiz-editor.ts` — `/p/:slug/edit` (JSON Soal mode only).
- `src/quiz-essay.ts` — `/p/:slug/essay` manual essay grading that recomputes final scores.
- `src/guide.ts` — `/panduan` usage guide.
- `src/tka-studio.ts` — `/studio` assessment prompt engine (ported from PHP/SQLite; its data lives in KV keys `tka:templates` / `tka:subjects`).
- `src/public-app.ts` — public `GET /p/:slug` (student sheet + `?print=1` print mode; `&kunci=1` is admin-only).
- `src/records.ts` — `POST /api/save|submit/:slug` + admin `GET /p/:slug/data` report.
- `src/auth-routes.ts` — `POST /api/login` (rate-limited) and `GET /api/logout`.
- `src/dashboard.ts` — admin `GET /` (login form when unauthenticated, dashboard otherwise; one large inline HTML template string).
- `src/actions.ts` — `POST /api/deploy|delete` and `POST /api/app/update`.
- `src/admin-shared.ts` — shared `errorPage` and the `denyAdminRequest` guard.

Admin mutations funnel through `denyAdminRequest()` (in `admin-shared.ts`) or `denyMediaRequest()` (in `media-routes.ts`) — session check plus CSRF; HTML forms post `_csrf`, fetch calls send `X-CSRF-Token`. Public student endpoints stay unguarded by design.

### Quiz pipeline (barrel: `src/quiz.ts`)

`quiz-types` (types + constants) → `quiz-util` (pure text helpers) → `quiz-media` (media slot detection, `media:slot-name` tokens) → `quiz-parse` (`parseQuizSpec`, normalisation, feature detection) → `quiz-rich` (markdown-subset renderer) → `quiz-grade` (`gradeSubmission`) → `quiz-page` (`renderQuizApp`, self-contained vanilla-JS page; CDN only for KaTeX/highlight.js). `parseQuizSpec` throws `QuizError` with teacher-readable Indonesian messages.

The stored data is layered on purpose: `quiz:<slug>` (normalised spec, used to regrade submissions server-side so browser scores can't be forged) vs `quizsource:<slug>` (the teacher's raw JSON, source of truth for the editor — its inner `slug` field is deliberately never synced to the final URL slug).

### Storage and the slug as identity

D1 has exactly one table (`app_records`, student submissions; no migrations system — `schema.sql` is it). KV holds everything else (keys listed in AGENTS.md). Publish never overwrites: a taken slug gets a random `-xxxx` suffix. Rename (`/api/app/update`) is order-sensitive: D1 rows are moved to the new slug *first* so a D1 failure never leaves two live slugs, then KV keys are rewritten and media moved.

### Frontend

Server-rendered HTML template strings inside TypeScript (dashboard, data report, panels — expect very long template literals in route handlers) plus hand-written browser JS/CSS under `public/vendor/` (`quiz-editor.js`, `quiz-essay.js`, `quiz-report.js`, `tka-studio.js`, `quiz.css`, vendored Geist/Amiri/Noto-Javanese fonts). `public/vendor/` is static assets, not a build output. The visual system (Geist, `--bg/--surface/--accent` variables, `prefers-color-scheme` dark mode) is shared across all teacher-facing pages.

## Conventions

- All user-facing text, docs, and commit messages are Indonesian.
- Tests are hand-rolled `.mjs` scripts with a small `check()` helper; add focused regression coverage to the matching test file when touching auth, media caps, slugs, or quiz parsing. `tests/quiz.test.mjs` also asserts the prompt document `docs/gemini-gem-prompt-full.md` — changing that doc means updating tests.
- Code comments reference the T0–T10 numbering from `docs/plan-hardening-auth.md`; planning docs live in `docs/*.md`.
