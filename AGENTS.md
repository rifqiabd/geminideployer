# AGENTS.md

## Project shape
- This is a single Cloudflare Worker using Hono; the entrypoint is `src/index.ts`.
- `src/index.ts` is wiring only (bindings type, CORS middleware, registrar mounting). `src/quiz.ts` is a barrel for the quiz modules. Route registrars live in `src/media-routes.ts`, `src/quiz-editor.ts`, `src/quiz-essay.ts`, `src/guide.ts`, `src/tka-studio.ts`, `src/public-app.ts`, `src/records.ts`, `src/auth-routes.ts`, `src/dashboard.ts`, and `src/actions.ts`; shared admin helpers (`errorPage`, `denyAdminRequest`) live in `src/admin-shared.ts`.
- `public/vendor/` contains browser-side editor, report, stylesheet, and font assets; it is not a generated `dist/` directory.
- User-facing UI and documentation are primarily Indonesian.

## Commands
- `npm test` runs the complete custom Node suite at `tests/quiz.test.mjs`.
- `npm run typecheck` runs `tsc --noEmit`; `tsconfig.json` checks `src/**/*.ts`, not the JavaScript tests.
- `npx wrangler dev` starts the local Worker; use `npx wrangler dev --env staging` for the staging environment.
- `npx wrangler deploy` deploys production; use `npx wrangler deploy --env staging` for staging.
- Apply the current local schema with `npx wrangler d1 execute gemini-db --local --file schema.sql`; remote execution requires explicit `--remote`.
- There is no lint, formatter, build, CI, or single-test script. Do not invent one; run `npm test` and `npm run typecheck` after changes.
- `package-lock.json` and `bun.lock` are both present. Use the existing npm workflow and do not regenerate/switch lockfiles without an explicit request.

## Runtime and storage
- `wrangler.jsonc` defines `STORAGE` (KV), `DB` (D1), and `ASSETS` (`public`). The `MEDIA` R2 binding is optional and currently commented out, so media falls back to KV.
- KV keys are compatibility-sensitive: `html:<slug>`, `meta:<slug>`, `quiz:<slug>`, `quizsource:<slug>`, `media:<slug>:<name>`, and `imggencfg:<slug>`.
- `schema.sql` currently defines only `app_records`; there is no migrations directory or migration runner configured.
- `STORAGE` is marked `remote: true` in `wrangler.jsonc`; do not assume local development uses only local storage. Staging has separate KV and D1 bindings.
- Media limits are 8 MB per file and 200 files per app. SVG is rejected; media slot names may contain dots and must not be filtered through `safeSlug()`.

## Security and compatibility
- Admin auth is an HMAC-SHA256 signed stateless session cookie (`src/auth.ts`, plan: `docs/plan-hardening-auth.md`). `SESSION_SECRET` and `APP_PASSWORD` are mandatory: when either is unset, login boots to a 503 setup page instead of any default password. The old static `authenticated_user` cookie is rejected everywhere; do not reintroduce it or any fallback password.
- All admin mutations (forms and fetch calls) require a CSRF token: `_csrf` field on HTML forms or `X-CSRF-Token` header on `fetch`. Public student endpoints (`/api/save/:slug`, `/api/submit/:slug`, `/media/:slug/:name`) stay open with `origin: '*'`; admin CORS is allowlisted via `ALLOWED_ORIGINS`.
- `GET /p/:slug?print=1&kunci=1` requires a valid admin session and answers 404 otherwise; `?print=1` without `kunci` stays public. `GET /api/media/:slug/gen-config` never returns `apiKey` — only `hasKey` — and saving BYOK settings with an empty key preserves the stored key.
- `/api/login` is rate-limited fail-closed via KV (5/min, 15-min lockout after 10 failures). Keep it fail-closed; the imggen counter is intentionally fail-open.
- Keep secrets in the gitignored `.dev.vars`; use `.dev.vars.example` as the shape. Do not read, print, or commit real secret values.
- `IMGGEN_API_URL` and `IMGGEN_API_KEY` are optional image-generation settings. `global_fetch_strictly_public` is required by the configured image proxy path; test proxy changes locally before removing it.
- `PPDB_WHATSAPP` (public `vars`, not a secret) is the WhatsApp number for the dashboard banner's PPDB 2027/2028 call-to-action. The "Daftar Sekarang" button always renders; the number only makes it target the admin directly (without it, WhatsApp opens with the message ready and the sender picks the contact).
- Preserve public behavior at `/p/:slug`. `/api/save/:slug` and `/api/submit/:slug` are aliases, and submissions for JSON quizzes are regraded server-side from `quiz:<slug>` before being stored in D1.
- Keep legacy KV key formats and `app_records` payload compatibility when changing dashboard, editor, media, or report flows.
- Browser-side per-student state on `/p/:slug` uses the `quiz-` localStorage prefix (`quiz-attempt:`, `quiz-started:`, `quiz-deadline:`, `quiz-student-name:`). A planned feature persists the last grading snapshot in `quiz-done:`/quiz-done-result:`; see `docs/plan-remember-result.md`. It is a localStorage-only convenience, never a lock, and it must never feed reports or `app_records`.

## Testing and changes
- Tests directly import `.ts` modules; `tests/quiz.test.mjs` and the others cover quiz parsing/rendering/grading, media helpers, reports, and prompt documents; `tests/auth.test.mjs` covers the session/CSRF helpers. None exercise Worker HTTP routes, KV, or D1 behavior.
- Keep imports compatible with both Wrangler bundling and Node's direct TypeScript execution; modules used by tests commonly use explicit `.ts` imports.
- For schema changes, update `schema.sql` and verify the local D1 command before any remote operation. For auth or route changes, add focused regression coverage alongside the existing suite.
- Do not overwrite unrelated dirty worktree files. Review the diff for only the files changed by the current task.
