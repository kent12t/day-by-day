# Day by Day

A moonlit journaling atlas built for quiet reflection. Each entry you make becomes a star in a procedural sky, creating a visual "memory palace" of your thoughts and growth.

Live site: [journal.pixelsmith.io](https://journal.pixelsmith.io)

## Philosophy

Most digital tools prioritize speed and capture. **Day by Day** is built for the opposite: the slow process of sitting with a question. 

### Why this exists
- **Visual Memory**: Instead of a linear list of dates, your reflections form a constellation. Proximity in the atlas is determined by topic and time, allowing you to see the "shape" of your life.
- **Privacy as a Default**: Your reflections are yours. Local-only journaling works by default, and optional cloud sync is explicit opt-in.
- **Curated Friction**: The app uses a "flip card" mechanic for prompts to encourage a moment of pause before you begin writing.

## Technology & Design Decisions

- **Local-First Architecture**: Data is persisted via `localStorage` for full offline use. Optional Cloudflare-backed sync can be connected manually when you want cross-device access.
- **Procedural Cartography**: The Sky Atlas is generated using vanilla SVG and mathematical seeding. Links between stars are formed based on shared topics and temporal sequence.
- **Minimalist Stack**: Built with vanilla JavaScript, CSS, and HTML5. Vite handles the build pipeline, keeping the footprint light and the performance high.
- **Deterministic Prompts**: A curated library of prompts is selected based on a hash of the current date and your journaling history to ensure variety without repetition.

## Local Development

If you wish to run the project locally or explore the code:

1. **Clone the repository**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Start the development server**:
   ```bash
   npm run dev
   ```
4. Open the local address provided by Vite (usually `http://localhost:5173`).

### Deployment
This project is configured for Cloudflare Pages (see `wrangler.toml`). To build and preview:
```bash
npm run build
npm run preview
```

### Optional Google auth for sync

Sync can be connected with Google OAuth using Cloudflare Pages Functions and KV sessions.

Required secrets (set in Cloudflare Pages project settings or `.dev.vars` for local):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_STATE_SECRET`

Required vars are already scaffolded in `wrangler.toml` (callback path, cookie settings, and OAuth state TTL).

Google OAuth redirect URI:

- Production: `https://journal.pixelsmith.io/api/auth/google/callback`
- Local Pages dev: `http://localhost:8788/api/auth/google/callback`

Legacy sync-key connection remains available for recovery and migration.

## Privacy Note
By default, all journal entries and photos are stored in your browser's local storage as stringified JSON and data URLs. Clearing your browser data will remove your entries unless you exported a backup.

If you explicitly connect sync, entries are stored in Cloudflare D1 and photos are stored in Cloudflare R2 under your private sync vault. Sync never runs automatically until you tap **Sync now**.

### Backup and Restore
- Open **Memories** to export your current entries as a JSON backup file.
- Use **Import memories** to restore or merge entries from a prior backup.
- Imports are validated and merged by entry ID to avoid accidental duplication.

---

*This project is public for the sake of open source transparency but is not currently open for external contributions.*
