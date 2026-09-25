# AGENTS.md

## Project shape
- This is a single Cloudflare Worker using Hono; the entrypoint is `src/index.ts`.
- `src/quiz.ts` is a barrel for the quiz modules. Route registrars live in `src/media-routes.ts`, `src/quiz-editor.ts`, `src/quiz-essay.ts`, `src/guide.ts`, and `src/tka-studio.ts`.
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
- Current auth is a static `auth_session=authenticated_user` cookie, and `src/index.ts:537-556` falls back to `admin123` when `APP_PASSWORD` is unset. Never deploy that fallback or treat the current cookie as a real identity system.
- Keep secrets in the gitignored `.dev.vars`; use `.dev.vars.example` as the shape. Do not read, print, or commit real secret values.
- `IMGGEN_API_URL` and `IMGGEN_API_KEY` are optional image-generation settings. `global_fetch_strictly_public` is required by the configured image proxy path; test proxy changes locally before removing it.
- Preserve public behavior at `/p/:slug`. `/api/save/:slug` and `/api/submit/:slug` are aliases, and submissions for JSON quizzes are regraded server-side from `quiz:<slug>` before being stored in D1.
- Keep legacy KV key formats and `app_records` payload compatibility when changing dashboard, editor, media, or report flows.

## Testing and changes
- Tests directly import `.ts` modules from `tests/quiz.test.mjs`; they cover quiz parsing/rendering/grading, media helpers, reports, and prompt documents, but not Worker HTTP routes, KV, or D1 behavior.
- Keep imports compatible with both Wrangler bundling and Node's direct TypeScript execution; modules used by tests commonly use explicit `.ts` imports.
- For schema changes, update `schema.sql` and verify the local D1 command before any remote operation. For auth or route changes, add focused regression coverage alongside the existing suite.
- Do not overwrite unrelated dirty worktree files. Review the diff for only the files changed by the current task.
