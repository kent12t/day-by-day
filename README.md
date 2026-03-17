# Day by Day

A moonlit journaling atlas built for quiet reflection. Each entry you make becomes a star in a procedural sky, creating a visual "memory palace" of your thoughts and growth.

Live site: [journal.pixelsmith.io](https://journal.pixelsmith.io)

## Philosophy

Most digital tools prioritize speed and capture. **Day by Day** is built for the opposite: the slow process of sitting with a question. 

### Why this exists
- **Visual Memory**: Instead of a linear list of dates, your reflections form a constellation. Proximity in the atlas is determined by topic and time, allowing you to see the "shape" of your life.
- **Privacy as a Default**: Your reflections are yours. There are no accounts, no cloud sync, and no databases. Everything is stored locally on your device.
- **Curated Friction**: The app uses a "flip card" mechanic for prompts to encourage a moment of pause before you begin writing.

## Technology & Design Decisions

- **Local-First Architecture**: Data is persisted via `localStorage`. This ensures the app works offline and maintains total user privacy.
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

## Privacy Note
All journal entries and photos are stored in your browser's local storage as stringified JSON and data URLs. Clearing your browser data will remove your entries. For long-term preservation, use the **Export memories** action in the Memories view and keep your backup JSON file safe.

### Backup and Restore
- Open **Memories** to export your current entries as a JSON backup file.
- Use **Import memories** to restore or merge entries from a prior backup.
- Imports are validated and merged by entry ID to avoid accidental duplication.

---

*This project is public for the sake of open source transparency but is not currently open for external contributions.*
