# Day by Day

Minimal local-first journaling web app with a growing procedural "Sky Atlas" ecosystem.

## Run (Vite + HMR)

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Then open the URL shown by Vite (usually `http://localhost:5173`).

## Static Option

If you want a plain static server instead:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Notes

- Data is stored in browser `localStorage`.
- Reflection photos are stored as data URLs in the same local storage (good for lightweight personal usage).
- Prompt library is versioned in `prompts.v1.core.json` and selected deterministically with anti-repeat rules.
