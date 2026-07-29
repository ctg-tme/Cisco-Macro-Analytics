## Agent skills

### Issue tracker

Issues and PRDs are local Markdown under ignored `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Interface design system

Treat the Magnetic Common Design System as the styling authority for every user-facing interface. Use `/Users/bomcgoni/Documents/GitHub/magnetic-common-design-system` as the reference implementation.

- Prefer Magnetic semantic tokens and component contracts over one-off colors, borders, spacing, focus states, or typography.
- Preserve the `data-cds-theme="magnetic-light|magnetic-dark"` contract and verify both themes.
- Do not introduce Momentum Design System packages, tokens, class names, or imports.
- Depart from Magnetic only when the reference has no applicable styling option or for the additive winter presentation.
- When the public Magnetic theme package is unavailable, keep the application’s consumed semantic-token subset synchronized with the reference repository and covered by regression tests.
- Apply the same design-system treatment to new dialogs, result views, source-review interfaces, maps, and other newly added surfaces.

Winter presentation remains seasonal and additive:

- keep decorative light strands on the outside edge of major outer containers only; never repeat them on nested cards, findings, source reviews, or other inner panels;
- use subtle frost treatment for inner panels instead of additional light frames;
- render all four light-frame sides on standard dialogs, and use the viewport perimeter for full-screen dialogs;
- render modal snowflakes from inside each dialog so they remain above the browser top layer, with `pointer-events: none`;
- preserve reduced-motion behavior and the `?winter=true` preview path;
- visually verify representative standard and full-screen dialogs, new interfaces, horizontal overflow, and browser console output in light and dark winter modes.

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
