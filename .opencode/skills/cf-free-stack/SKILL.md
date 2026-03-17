---
name: cf-free-stack
description: Reference guide for Cloudflare free-tier services (Pages, D1, KV, R2, Workers, Access) with limits, patterns, and wrangler config snippets for day-by-day
license: MIT
compatibility: opencode
metadata:
  project: day-by-day
  audience: agents
  stack: cloudflare-free
---

## Cloudflare Free-Tier Stack for day-by-day

All services below are available on Cloudflare's **free plan**. No credit card charges occur when staying within these limits.

---

### Cloudflare Pages

- **Cost**: Free (unlimited sites).
- **Builds**: 500/month, max 20 min per build.
- **Requests**: 100,000/day, unlimited bandwidth.
- **Custom domains**: Supported (CNAME/ALIAS to `<project>.pages.dev`).
- **wrangler.toml** minimum:
  ```toml
  name = "day-by-day"
  pages_build_output_dir = "dist"
  ```
- **Deploy command**: `wrangler pages deploy dist`
- **Build command** (set in Pages dashboard): `npm run build`

---

### Cloudflare D1 (SQLite at the edge)

- **Cost**: Free.
- **Limits**: 5 GB storage, 5M row reads/day, 100k row writes/day, 10k databases.
- **Use cases**: Journal entries table, user accounts, sync metadata.
- **wrangler.toml binding**:
  ```toml
  [[d1_databases]]
  binding = "DB"
  database_name = "day-by-day-db"
  database_id = "<your-database-id>"
  ```
- **Create database**: `wrangler d1 create day-by-day-db`
- **Run migrations**: `wrangler d1 migrations apply day-by-day-db`
- **Pages Function usage**:
  ```js
  export async function onRequest(context) {
    const { DB } = context.env;
    const entries = await DB.prepare("SELECT * FROM entries WHERE user_id = ?")
      .bind(userId)
      .all();
    return Response.json(entries.results);
  }
  ```

---

### Cloudflare KV (Key-Value Store)

- **Cost**: Free.
- **Limits**: 100k reads/day, 1k writes/day, 1 GB storage, 25 namespaces.
- **Use cases**: Session tokens, user preferences, last-sync timestamps.
- **wrangler.toml binding**:
  ```toml
  [[kv_namespaces]]
  binding = "SESSIONS"
  id = "<your-namespace-id>"
  ```
- **Create namespace**: `wrangler kv namespace create SESSIONS`
- **Pages Function usage**:
  ```js
  const session = await context.env.SESSIONS.get(sessionId, { type: "json" });
  await context.env.SESSIONS.put(sessionId, JSON.stringify(data), { expirationTtl: 86400 });
  ```

---

### Cloudflare R2 (Object Storage)

- **Cost**: Free.
- **Limits**: 10 GB storage, 1M Class A ops/month (writes), 10M Class B ops/month (reads).
- **Use cases**: Storing journal photo uploads (base64 data URLs → binary blobs).
- **wrangler.toml binding**:
  ```toml
  [[r2_buckets]]
  binding = "PHOTOS"
  bucket_name = "day-by-day-photos"
  ```
- **Create bucket**: `wrangler r2 bucket create day-by-day-photos`
- **Pages Function upload**:
  ```js
  await context.env.PHOTOS.put(`photos/${userId}/${entryId}`, binaryBody, {
    httpMetadata: { contentType: "image/jpeg" }
  });
  ```

---

### Cloudflare Workers (via Pages Functions)

- **Cost**: Free (bundled with Pages).
- **Limits**: 100k requests/day, 10ms CPU per invocation (free), 128 MB memory.
- **Location**: `functions/` directory at project root.
- **Routing**: File path maps to URL path. `functions/api/entries.js` → `/api/entries`.
- **ES module export pattern**:
  ```js
  export const onRequestGet = async (context) => { ... };
  export const onRequestPost = async (context) => { ... };
  ```

---

### Cloudflare Access (Zero-Trust Auth)

- **Cost**: Free for up to 50 users per team.
- **Use cases**: Internal team access, simple auth gate without custom code.
- **Limits**: 50 seats free; beyond that, requires Teams plan.
- **Note**: Not suitable for a public journaling app with unlimited users. Use OAuth + D1 sessions for public auth instead.

---

### Free OAuth Providers (no CF-specific limits)

| Provider | Free? | Notes |
|----------|-------|-------|
| GitHub OAuth | Yes, unlimited | Good for developer-adjacent users |
| Google OAuth | Yes, unlimited | Widest coverage |
| Discord OAuth | Yes, unlimited | Good for community apps |

**OAuth flow with Pages Functions**:
1. Redirect to provider authorization URL.
2. Provider redirects back to `/api/auth/callback?code=...`.
3. Exchange code for access token via provider API.
4. Create session in KV, set `Set-Cookie: session=<id>; HttpOnly; Secure; SameSite=Lax`.
5. Redirect to app.

---

### Free Email (for Magic Links)

| Service | Free limit | Notes |
|---------|-----------|-------|
| Mailchannels | Free via CF Workers | No API key needed; use `fetch` to Mailchannels Send API |
| Resend | 3,000 emails/month | Requires API key |
| Brevo | 300 emails/day | Requires API key |

---

### wrangler.toml full example (with all bindings)

```toml
name = "day-by-day"
pages_build_output_dir = "dist"

[vars]
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "day-by-day-db"
database_id = "REPLACE_WITH_ACTUAL_ID"

[[kv_namespaces]]
binding = "SESSIONS"
id = "REPLACE_WITH_ACTUAL_ID"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "day-by-day-photos"
```

---

### Staying within free limits — checklist

- [ ] Photos stored in R2, not as base64 in D1 rows.
- [ ] Session tokens stored in KV with TTL (not D1) to reduce read load.
- [ ] Batch D1 writes where possible (use `batch()` API).
- [ ] Client-side caching with `localStorage` as the primary layer; D1 sync is secondary.
- [ ] No background sync workers (would exhaust 100k/day Workers limit quickly).
- [ ] Monitor usage in Cloudflare dashboard → Analytics.
