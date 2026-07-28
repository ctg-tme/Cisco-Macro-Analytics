## Agent skills

### Issue tracker

Issues and PRDs are local Markdown under ignored `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Product version

Treat the **Product Version** defined in `CONTEXT.md` as part of every completed user-visible change set. Before handing off a feature or fix:

- apply pre-1.0 semantic versioning: increment the patch for fixes and small enhancements, or the minor version for meaningful new capabilities;
- keep the prerelease label until the product leaves beta;
- synchronize `manifest.json` (`Version`), `package.json` and `package-lock.json` (`version`), the fallback banner in `index.html`, and the version assertion in `src/ux-regression.test.ts`;
- do not bump the Product Version for analysis-only work, refactors with no user-visible effect, or documentation and test changes.
