# Day by Day

A moonlit journaling atlas built for quiet reflection. Each entry you make becomes a star in a procedural sky, creating a visual "memory palace" of your thoughts and growth.

Live site: [journal.pixelsmith.io](https://journal.pixelsmith.io)

## Philosophy

Most digital tools prioritize speed and capture. **Day by Day** is built for the opposite: the slow process of sitting with a question. 

### Why this exists
- **Visual Memory**: Instead of a linear list of dates, your reflections form a constellation. Proximity in the atlas is determined by topic and time, allowing you to see the "shape" of your life.
- **Privacy as a Default**: Your reflections are yours. Everything stays in your browser. There are no accounts, no server, and no sync.
- **Curated Friction**: The app uses a "flip card" mechanic for prompts to encourage a moment of pause before you begin writing.

## Technology & Design Decisions

- **Local-First Architecture**: Data is persisted via `localStorage` for full offline use. To move between devices, export a backup and import it on the other device.
- **Procedural Cartography**: The Sky Atlas is a deterministic oil-style painting of a night sky (milky way, topic-tinted nebulae, a glow for every entry), repainted in a Web Worker from your entries by a small stroke engine in `atlas/` and cached locally in IndexedDB. Crisp SVG star cores and gold-ink constellation lines sit on top; links between stars are formed based on shared topics and temporal sequence.
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
4. Open the local address provided by Vite (`http://localhost:3000`).

### Deployment
This project is deployed as a static site on Cloudflare Pages (see `wrangler.toml`). There is no backend. To build and preview:
```bash
npm run build
npm run preview
```

## Privacy Note
By default, journal entries are stored in your browser's local storage as JSON, and photos are compressed (max 1600px, WebP/JPEG) and stored in the browser's IndexedDB on this device. Clearing your browser data will remove your entries unless you exported a backup. Exports embed photos so a backup file is self-contained.

Your entries are never sent to a server. Apart from loading its own bundled prompt library and the web fonts (Google Fonts), the app makes no network requests. Earlier versions offered optional cloud sync; that has been removed, and any leftover sync settings in your browser are cleaned up automatically.

### Backup and Restore
Export/import is the way to back up your journal or move it to another device.

- Open **Memories** and tap the gear icon (**Backup & restore**) to export your current entries as a JSON backup file.
- Use **Import** in the same sheet to restore or merge entries from a prior backup.
- Imports are validated and merged by entry ID to avoid accidental duplication.

---

*This project is public for the sake of open source transparency but is not currently open for external contributions.*
