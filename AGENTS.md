# 🌙 Day by Day - Agent Guide
This file gives coding agents a practical operating guide for this repository.
Follow it when planning, editing, testing, and validating changes.

## 1) Project Snapshot
- Stack: vanilla JavaScript, HTML, CSS, Vite.
- Runtime target: modern browsers (desktop + mobile).
- Persistence: browser `localStorage` only.
- Deployment target: Cloudflare Pages (`wrangler.toml`, `dist/`).
- Main app logic lives in `app.js`.
- Prompt content is in `public/prompts.v1.core.json`.

## 2) Source Map
- `index.html`: app shell, views, controls, semantic structure.
- `app.js`: state, prompt logic, atlas rendering, events, persistence.
- `styles.css`: theme tokens, layout, animations, responsive behavior.
- `vite.config.js`: Vite build/dev configuration.
- `public/prompts.v1.core.json`: prompt dataset.
- `wrangler.toml`: Cloudflare Pages output settings.
- `README.md`: philosophy, architecture intent, local dev notes.

## 3) Build / Dev / Lint / Test Commands
### Install
- `npm install`

### Local development
- `npm run dev`
- Vite dev server is configured for port `3000`.

### Production build and preview
- `npm run build`
- `npm run preview`

### Linting / formatting status
- No ESLint, Prettier, or stylelint config exists today.
- Before introducing tooling, keep changes minimal and consistent with current style.

### Testing status
- No automated test runner is configured yet.
- There are no `*.test.*` or `*.spec.*` files in this repo.

### Running a single test (important)
- Not available yet because no test framework is installed.
- If tests are added later (recommended: Vitest), use patterns like:
- `npm run test -- app.test.js`
- `npm run test -- -t "saveEntry"`

## 4) Manual Verification Checklist (Current Reality)
When behavior changes, run `npm run dev` and verify:
- Reflect flow: reveal prompt -> customize/use -> save entry.
- Capture modes: offline, text, photo.
- Atlas interactions: pan, zoom buttons, wheel zoom, recenter, latest star.
- Memory interactions: expand card, delete confirmation, delete success.
- Persistence: reload page and confirm entries still render.
- Empty state: no entries should show the guided atlas hint text.
- Mobile checks: bottom nav, file input, touch drag/scroll behavior.
- Reduced motion: app remains functional with animations disabled.

## 5) Cursor / Copilot Rules
- Checked `.cursor/rules/`: not present.
- Checked `.cursorrules`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- Therefore, no additional editor-specific AI rules are currently enforced.

## 6) Code Style Guidelines (Repository-Specific)
### JavaScript
- Use `const` by default; use `let` only when reassignment is needed.
- In `app.js`, use double quotes to match existing style.
- Use semicolons consistently.
- Prefer early returns for guard conditions.
- Keep utility functions pure where practical (`clamp`, `truncate`, hashing).
- Keep side effects explicit in UI and persistence functions.

### Imports and modules
- Browser app code currently uses one module entrypoint (`app.js`).
- Avoid unnecessary file splitting unless complexity clearly justifies it.
- If splitting modules, separate by concern (state, atlas, prompts, storage).
- Keep import ordering stable and avoid circular dependencies.

### Types and data shapes
- JavaScript only (no TypeScript in current repo).
- Keep entry objects backward compatible with persisted `localStorage` data.
- Use explicit field names and stable keys (`id`, `date`, `topic`, `mode`, etc.).
- If schema changes, version storage keys and migrate safely.

### Naming conventions
- Constants: `UPPER_SNAKE_CASE` (`STORAGE_KEY`, `WORLD_WIDTH`).
- State fields: `camelCase` (`selectedTopic`, `pendingDeleteId`).
- Functions: `camelCase`, verb-first (`renderSkyAtlas`, `saveEntry`).
- DOM refs: noun phrases (`historyList`, `zoomInBtn`).

### Formatting and structure
- Keep existing indentation and spacing style.
- Prefer short readable functions; extract helpers when blocks get dense.
- Group related constants near the top of `app.js`.
- Keep event binding centralized in `bindEvents()`.

### DOM/UI patterns
- Use `document.createElement` / `createSvg` for dynamic nodes.
- Use class toggling for state (`hidden`, `active`, `revealed`, `locked`).
- Preserve accessibility attributes (`aria-*`, `role`, `tabindex`) when editing UI.
- Keep text content updates centralized and intentional.

### Error handling
- Wrap external/resource operations with `try/catch`.
- Follow fail-soft behavior: log clearly, provide usable fallback.
- Prompt fetch should fallback to an empty prompt array.
- `localStorage` parse failures should return safe defaults.
- Validation failures should surface through toast messaging, not thrown exceptions.

### CSS conventions
- Keep theme tokens in `:root` CSS variables.
- Prefer existing tokens over hardcoded colors.
- Keep responsive behavior; avoid desktop-only assumptions.
- Respect `prefers-reduced-motion` behavior.

## 7) Architecture Constraints to Respect
- Privacy-first model: no accounts, backend, or remote sync.
- Offline-friendly behavior should remain intact.
- Core app identity is reflective and atmospheric; avoid sterile UI changes.
- Atlas rendering should stay deterministic from saved entries.

## 8) Feature Gaps Noted from README + Code
Useful opportunities for future work:
- Data export (README calls this "feature coming soon").
- Data import/restore flow for backups or device migration.
- Automated test suite (unit + UI interaction smoke tests).
- Lint/format toolchain for consistency at scale.
- Optional encrypted backup strategy while preserving privacy defaults.
- Prompt content governance (schema validation + check scripts).

## 9) Suggested Agent Workflow
- Read `README.md` and relevant files before editing.
- Make focused changes; avoid broad refactors unless requested.
- Run `npm run build` after meaningful code edits.
- If behavior changed, complete manual checks from section 4.
- In final notes, report commands run and user-visible impact.

## 10) Change Safety Rules
- Do not remove or reset existing user-facing storage keys casually.
- Do not introduce network calls that violate privacy-first design.
- Do not break mobile layout or bottom navigation ergonomics.
- Do not weaken delete confirmation safeguards.

## 11) If You Add Tooling Later
When adding lint/tests, keep scripts explicit in `package.json`:
- `lint`, `lint:fix`
- `test`, `test:watch`, `test:coverage`
- Single-test by file and by test name should be documented in `README.md` and this file.

Keep this AGENTS.md updated whenever commands, architecture, or standards change.

## 12) OpenCode Subagents (`.opencode/agents/`)

Specialized subagents that can be invoked via `@mention` in OpenCode or automatically by the Build agent.

| Agent file | Name | Mode | Purpose |
|---|---|---|---|
| `cf-pages-deploy.md` | `cf-pages-deploy` | subagent | Cloudflare Pages config, wrangler, D1/KV/R2 bindings |
| `auth-designer.md` | `auth-designer` | subagent | Plans free-tier auth (read-only until approved) |
| `db-designer.md` | `db-designer` | subagent | D1 schema, migrations, Pages Functions API |
| `privacy-guard.md` | `privacy-guard` | subagent | Privacy audit — read-only, produces PASS/WARN/FAIL report |
| `atlas-renderer.md` | `atlas-renderer` | subagent | SVG Sky Atlas rendering and cartography logic |
| `code-reviewer.md` | `code-reviewer` | subagent | Code quality + security review — read-only |

### When to invoke each subagent

- **`@cf-pages-deploy`** — any changes to `wrangler.toml`, Pages Functions, or CF service bindings.
- **`@auth-designer`** — before starting auth implementation; get a plan first.
- **`@db-designer`** — designing D1 schema, writing SQL migrations, or building API endpoints.
- **`@privacy-guard`** — after any change that touches storage, network calls, or user data flow.
- **`@atlas-renderer`** — changes to atlas rendering, star placement, or pan/zoom behavior.
- **`@code-reviewer`** — before merging significant changes.

---

## 13) OpenCode Skills (`.opencode/skills/`)

Reusable instruction sets loaded on-demand by agents via the `skill` tool.

| Skill directory | Name | Description |
|---|---|---|
| `cf-free-stack/` | `cf-free-stack` | Cloudflare free-tier limits, config snippets, wrangler patterns |
| `day-by-day-conventions/` | `day-by-day-conventions` | Code style, naming, entry schema, build/verify checklist |
| `storage-migration/` | `storage-migration` | localStorage → D1 migration patterns, merge logic, photo R2 strategy |
| `git-release/` | `git-release` | Versioning, release notes, tagging, Cloudflare Pages deploy verification |

### Skill loading guidance

- Agents that touch CF config should load `cf-free-stack` first.
- Any agent editing `app.js`, `styles.css`, or `index.html` should load `day-by-day-conventions` first.
- `storage-migration` is loaded by `db-designer` and `cf-pages-deploy` when designing sync.
- `git-release` is loaded when preparing a tagged release.

---

## 14) Planned Architecture (Future State)

When auth and online DB are implemented, the stack will be:

```
Browser (localStorage cache)
    ↕  sync on login / explicit action
Cloudflare Pages Functions (functions/api/)
    ↕
Cloudflare D1 (entries table, users table)   ← free: 5 GB, 5M reads/day
Cloudflare KV (session tokens)               ← free: 100k reads/day
Cloudflare R2 (photo blobs)                  ← free: 10 GB, 1M writes/month
```

Auth options under evaluation (all free, no paid services):
- GitHub OAuth + D1 sessions (recommended for developer users)
- Google OAuth + D1 sessions (widest coverage)
- Magic links via Mailchannels (free via CF Workers, no API key needed)

**All services must remain on Cloudflare free tier. No paid services.**
