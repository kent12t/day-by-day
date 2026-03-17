---
name: day-by-day-conventions
description: Code style, architecture rules, and entry data shape for the day-by-day journaling app — vanilla JS, Vite, Cloudflare Pages
license: MIT
compatibility: opencode
metadata:
  project: day-by-day
  audience: agents
  stack: vanilla-js-vite
---

## day-by-day Code Conventions

Load this skill before editing any file in the day-by-day repository.

---

### Stack overview

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES modules), HTML5, CSS3 |
| Build tool | Vite (port 3000 in dev) |
| Hosting | Cloudflare Pages |
| Storage (current) | Browser `localStorage` |
| Storage (planned) | Cloudflare D1 + KV + R2 (free tier) |
| Auth (planned) | OAuth (GitHub/Google) + D1 sessions |

---

### JavaScript style

- `const` by default; `let` only when reassignment is required.
- **Double quotes** for strings (matches existing `app.js`).
- Semicolons required.
- Prefer early returns for guard conditions over nested if blocks.
- Keep utility functions **pure** where practical (`clamp`, `truncate`, hashing).
- Side effects belong in dedicated UI and persistence functions, not utilities.
- No TypeScript — plain JavaScript throughout.

---

### Naming conventions

| Type | Convention | Example |
|------|-----------|---------|
| Constants | `UPPER_SNAKE_CASE` | `STORAGE_KEY`, `WORLD_WIDTH` |
| State fields | `camelCase` | `selectedTopic`, `pendingDeleteId` |
| Functions | `camelCase`, verb-first | `renderSkyAtlas`, `saveEntry` |
| DOM references | noun phrases | `historyList`, `zoomInBtn` |
| CSS variables | kebab-case with `--` prefix | `--color-star`, `--spacing-md` |

---

### `app.js` structure rules

- Group related constants near the top of the file.
- Keep event binding centralized inside `bindEvents()`.
- Do not create new files unless the complexity clearly justifies a split.
- If splitting: separate by concern — `state.js`, `atlas.js`, `prompts.js`, `storage.js`.
- Avoid circular dependencies.

---

### Entry data shape (stable contract)

```js
{
  id: "string",           // unique, e.g. crypto.randomUUID() or timestamp hash
  date: "ISO 8601",       // e.g. "2026-03-17T14:22:00.000Z"
  topic: "string",        // slug-style, e.g. "gratitude", "creativity"
  mode: "text|photo|offline",
  text: "string|null",    // journal text content
  photoDataUrl: "string|null", // base64 data URL (to be migrated to R2 URL)
  prompt: "string"        // the prompt text shown to the user
}
```

**Backward compatibility rule**: Never remove or rename these fields. Add new fields additively. Version the `localStorage` key if shape changes incompatibly.

Current storage key: `STORAGE_KEY` (defined at top of `app.js`).

---

### DOM / UI patterns

- Dynamic elements: `document.createElement()` and `createSvg()` helper.
- State toggling: add/remove CSS classes (`hidden`, `active`, `revealed`, `locked`).
- Text updates: direct `.textContent` assignment; never use `.innerHTML` with user data.
- Preserve all `aria-*`, `role`, `tabindex` attributes when editing UI components.

---

### CSS conventions

- All theme values in `:root` CSS custom properties.
- Use existing tokens; no hardcoded color hex values in component rules.
- Keep responsive behavior — no desktop-only assumptions.
- Honor `@media (prefers-reduced-motion: reduce)` — all animations must have a static fallback.

---

### Error handling rules

- Wrap all `localStorage` reads/writes in `try/catch`.
- Wrap all `fetch` / network calls in `try/catch`.
- On error: log clearly to console, return a safe default, never throw to the UI.
- Surface user-facing errors through the toast notification system, not `alert()` or thrown exceptions.
- Prompt fetch failures must fall back to an empty array.

---

### Architecture constraints (non-negotiable)

1. **Privacy-first**: No journal content ever leaves the device without explicit user action.
2. **Offline-capable**: The app must work fully without a network connection.
3. **Free-tier only**: No paid services for development, CI/CD, hosting, or runtime.
4. **Deterministic atlas**: Star positions must be reproducible from the same entry data.
5. **Delete safety**: Delete confirmation flow must not be weakened.
6. **Mobile ergonomics**: Bottom navigation and touch interactions must remain functional.

---

### Build and verification

```bash
npm install          # install deps
npm run dev          # dev server on port 3000
npm run build        # production build → dist/
npm run preview      # preview production build
```

After any code change: run `npm run build` and confirm zero errors before marking work done.

Manual verification checklist (run after behavior changes):
- Reflect flow: reveal prompt → customize/use → save entry.
- Capture modes: offline, text, photo.
- Atlas: pan, zoom, recenter, latest star.
- Memories: expand card, delete confirmation, delete success.
- Persistence: reload page, entries still render.
- Empty state: guided atlas hint text visible.
- Mobile: bottom nav, file input, touch behavior.
- Reduced motion: app functional with animations disabled.
