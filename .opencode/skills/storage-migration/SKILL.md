---
name: storage-migration
description: Patterns and checklist for safely migrating day-by-day data from localStorage to Cloudflare D1, with merge logic, rollback, and backward compatibility
license: MIT
compatibility: opencode
metadata:
  project: day-by-day
  audience: agents
  workflow: data-migration
---

## localStorage → Cloudflare D1 Migration Playbook

Use this skill whenever designing or implementing the sync/migration path from the current browser-only storage to Cloudflare D1.

---

### Guiding principles

1. **Additive, never destructive**: The online DB is a sync target, not a replacement. `localStorage` remains the local cache and offline fallback.
2. **User-initiated**: Migration only runs when the user explicitly authenticates. Anonymous use is never degraded.
3. **Idempotent**: Running the migration twice must produce the same state (use `INSERT OR IGNORE` / upsert by `id`).
4. **Privacy-preserving**: Entries are sent to D1 only over HTTPS, only to the authenticated user's own rows.
5. **Reversible**: Users can always export their data (JSON) and clear their account, returning to local-only mode.

---

### Entry shape (stable contract)

```js
// localStorage format (current)
{
  id: "string",           // stable unique key
  date: "ISO 8601",
  topic: "string",
  mode: "text|photo|offline",
  text: "string|null",
  photoDataUrl: "string|null",  // large — must move to R2
  prompt: "string"
}
```

---

### D1 schema target

```sql
-- migration: 001_create_entries
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  topic       TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK(mode IN ('text', 'photo', 'offline')),
  text        TEXT,
  photo_key   TEXT,          -- R2 object key, NULL if no photo
  prompt      TEXT NOT NULL,
  synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT           -- soft delete; NULL = active
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_entries_user_topic ON entries(user_id, topic);
```

---

### Photo migration strategy

`photoDataUrl` base64 strings can be 1–5 MB each. Storing them in D1 text rows would quickly exhaust the 5 GB D1 limit.

**Correct approach**:
1. On upload: decode base64 → `Uint8Array`, PUT to R2 at `photos/{userId}/{entryId}`.
2. Store the R2 object key (`photo_key`) in the D1 row.
3. On read: generate a pre-signed R2 URL (or serve via a Pages Function proxy).
4. In `localStorage`: keep the base64 as the local cache; replace with R2 URL after successful upload.

```js
// Pages Function: POST /api/entries/:id/photo
export async function onRequestPost(context) {
  const { PHOTOS } = context.env;
  const { userId, entryId } = context.params;
  const body = await context.request.arrayBuffer();
  const key = `photos/${userId}/${entryId}`;
  await PHOTOS.put(key, body, {
    httpMetadata: { contentType: context.request.headers.get("Content-Type") }
  });
  return Response.json({ key });
}
```

---

### Migration flow (client-side)

```js
async function migrateLocalStorageToCloud(userId, apiBase) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    console.error("Migration: failed to parse localStorage");
    return;
  }

  for (const entry of entries) {
    try {
      // 1. Upload photo if present
      let photoKey = null;
      if (entry.photoDataUrl) {
        photoKey = await uploadPhoto(userId, entry.id, entry.photoDataUrl, apiBase);
      }

      // 2. Upsert entry in D1 (idempotent)
      await fetch(`${apiBase}/api/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: entry.id,
          date: entry.date,
          topic: entry.topic,
          mode: entry.mode,
          text: entry.text,
          photoKey,
          prompt: entry.prompt
        })
      });
    } catch (err) {
      console.error(`Migration: failed for entry ${entry.id}`, err);
      // Continue with remaining entries — partial migration is acceptable
    }
  }
}
```

---

### Merge / conflict resolution rules

When pulling entries from D1 to a new device (or after re-login):

| Situation | Rule |
|-----------|------|
| Entry exists locally, not in D1 | Upload to D1 |
| Entry exists in D1, not locally | Download to `localStorage` |
| Entry exists in both, same content | No-op (use `id` as key) |
| Entry exists in both, different content | **D1 wins** (server is source of truth after first sync) |
| Entry deleted locally | Soft-delete in D1 (`deleted_at = NOW()`) |
| Entry deleted in D1 | Remove from `localStorage` |

---

### Pages Function: upsert endpoint

```js
// functions/api/entries.js
export async function onRequestPost(context) {
  const { DB } = context.env;
  const session = await getSession(context); // validate auth
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await context.request.json();
  const { id, date, topic, mode, text, photoKey, prompt } = body;

  // Input validation
  if (!id || !date || !topic || !mode || !prompt) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!["text", "photo", "offline"].includes(mode)) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  await DB.prepare(`
    INSERT INTO entries (id, user_id, date, topic, mode, text, photo_key, prompt, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      photo_key = excluded.photo_key,
      synced_at = excluded.synced_at
  `).bind(id, session.userId, date, topic, mode, text ?? null, photoKey ?? null, prompt).run();

  return Response.json({ ok: true });
}
```

---

### Rollback / opt-out

Users can return to local-only mode at any time:
1. Export all entries as JSON from the Memories view.
2. Delete account (soft-delete all D1 rows, delete R2 objects, invalidate session).
3. `localStorage` data is unaffected — app continues to work offline.

---

### Migration checklist

Before shipping the migration:
- [ ] D1 schema created and migration applied to production database.
- [ ] R2 bucket created and bound in `wrangler.toml`.
- [ ] Photo upload endpoint tested with entries containing large base64 images.
- [ ] Upsert endpoint is idempotent (run twice, verify no duplicates).
- [ ] Merge logic tested: local-only entries upload, D1-only entries download.
- [ ] Soft-delete flow tested end-to-end.
- [ ] Anonymous users cannot access `/api/entries` endpoints (returns 401).
- [ ] No `photoDataUrl` base64 data logged in Workers logs.
- [ ] Export (JSON download) still works after migration.
- [ ] App works fully offline after migration (localStorage still populated).
