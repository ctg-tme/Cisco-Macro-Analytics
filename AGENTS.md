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

### Local commits and pushes

- Agents may create local commits for completed work without requesting additional permission.
- Never push changes unless the user explicitly asks for a push.

### Local development server

After completing any work:

- check whether port `5176` is serving this repository's page;
- if nothing is listening, start this repository's local development server;
- if another page is being served, stop the process listening on port `5176` and start this repository's local development server;
- post the server address in the task chat unless it has already been posted in that task on the same calendar day.
