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
