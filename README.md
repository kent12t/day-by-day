# Day by Day

Minimal local-first journaling web app with a growing procedural "Sky Atlas" ecosystem.

## Run

Use any static server from this folder, for example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Notes

- Data is stored in browser `localStorage`.
- Reflection photos are stored as data URLs in the same local storage (good for lightweight personal usage).
- Prompt library is versioned in `prompts.v1.core.json` and selected deterministically with anti-repeat rules.
