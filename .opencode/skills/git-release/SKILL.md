---
name: git-release
description: Create consistent tagged releases and changelogs for day-by-day using git and the GitHub CLI
license: MIT
compatibility: opencode
metadata:
  project: day-by-day
  audience: maintainers
  workflow: github
---

## Release Workflow for day-by-day

Use this skill when preparing a tagged release of the day-by-day app.

---

### Versioning scheme

day-by-day uses **Semantic Versioning** (`MAJOR.MINOR.PATCH`):

| Change type | Version bump |
|-------------|-------------|
| Breaking change to entry data shape or localStorage schema | MAJOR |
| New user-visible feature (new capture mode, atlas behavior, auth) | MINOR |
| Bug fix, style tweak, copy change, accessibility improvement | PATCH |

Current version is in `package.json` → `"version"`.

---

### Pre-release checklist

Before tagging:
- [ ] All feature work merged to `main`.
- [ ] `npm run build` passes with zero errors.
- [ ] Manual verification checklist passed (see `AGENTS.md` section 4).
- [ ] No accidental `console.log` statements left in `app.js`.
- [ ] `wrangler.toml` does not contain any placeholder `REPLACE_WITH_ACTUAL_ID` values.
- [ ] `README.md` is up to date with any new features.
- [ ] `AGENTS.md` updated if commands, agents, or skills changed.

---

### Steps

1. **Determine version bump** by reviewing commits since the last tag:
   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   ```

2. **Update `package.json` version**:
   ```bash
   # example for a patch bump
   npm version patch --no-git-tag-version
   ```

3. **Draft release notes** from merged commits:
   - Group by: Features, Bug Fixes, Improvements, Internals.
   - Use plain language — users, not just developers, read these.
   - Reference issue/PR numbers where applicable.

4. **Commit the version bump**:
   ```bash
   git add package.json
   git commit -m "chore: bump version to vX.Y.Z"
   ```

5. **Create and push the tag**:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

6. **Create GitHub release** using the CLI:
   ```bash
   gh release create vX.Y.Z \
     --title "vX.Y.Z — <short description>" \
     --notes "$(cat <<'EOF'
   ## What's new
   
   ### Features
   - ...
   
   ### Bug Fixes
   - ...
   
   ### Internals
   - ...
   EOF
   )"
   ```

---

### Cloudflare Pages auto-deploy

Cloudflare Pages is connected to the `main` branch. Every push to `main` triggers a new build automatically. Tagging does not trigger a separate build — the commit that bumped the version already deployed.

To verify the deployment:
```bash
wrangler pages deployment list --project-name day-by-day
```

---

### Hotfix process

For urgent production fixes:
1. Branch off the current tag: `git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z`
2. Apply the fix with a focused commit.
3. `npm run build` and verify.
4. Merge to `main` via PR.
5. Follow the normal release steps above with a PATCH bump.
