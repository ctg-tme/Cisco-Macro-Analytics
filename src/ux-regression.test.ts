import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as { Version: string };
const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const packageLockMetadata = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
) as { version: string; packages: { '': { version: string } } };

describe('Cisco Macro Analyzer product shell', () => {
  it('keeps the original task and identity obvious', () => {
    expect(html).toContain('<title>Cisco Macro Analyzer</title>');
    expect(html).toContain('Upload macro files');
    expect(html).toContain('Exploratory Analysis across validated RoomOS versions');
    expect(html).toContain('Analyze macro');
    expect(html.indexOf('Upload macro files')).toBeLessThan(
      html.indexOf('Exploratory Analysis across validated RoomOS versions'),
    );
  });

  it('reserves the site icon dimensions before CSS loads', () => {
    expect(html).toContain(
      '<img class="brand-mark" src="/favicon.svg" width="29" height="29" alt="" aria-hidden="true" />',
    );
    expect(html).toContain(
      '<img class="brand-mark small" src="/favicon.svg" width="23" height="23" alt="" aria-hidden="true" />',
    );
  });

  it('shows the beta release and current copyright in the product shell', () => {
    expect(manifest.Version).toBe('0.3.1-BETA');
    expect(packageMetadata.version).toBe('0.3.1-beta');
    expect(packageMetadata.version).toBe(manifest.Version.toLowerCase());
    expect(packageLockMetadata.version).toBe(packageMetadata.version);
    expect(packageLockMetadata.packages[''].version).toBe(packageMetadata.version);
    expect(html).toContain('class="beta-banner"');
    expect(html).toContain(`<strong id="app-version">v${manifest.Version}</strong>`);
    expect(main).toContain("import manifest from '../manifest.json'");
    expect(main).toContain('elements.appVersion.textContent = `v${manifest.Version}`');
    expect(css).toContain('.beta-banner');
    expect(html).toContain('id="current-year"');
    expect(html).toContain('Cisco Systems, Inc.');
    expect(html).toContain('Created by the Collaboration TME team');
    expect(main).toContain('elements.currentYear.textContent = String(new Date().getFullYear())');
  });

  it('keeps the footer visible without covering the end of the page', () => {
    expect(css).toMatch(/body \{[^}]*padding-bottom: var\(--footer-height\)/s);
    expect(css).toMatch(/footer \{[^}]*position: fixed;[^}]*bottom: 0;/s);
    expect(css).toMatch(/footer \{[^}]*height: var\(--footer-height\)/s);
    expect(css).toContain('--footer-height: 92px');
  });

  it('offers an accessible, safely isolated feedback link', () => {
    expect(html).toContain('>Bugs / Suggestions</a>');
    expect(html).toContain(
      'href="https://github.com/ctg-tme/Cisco-Macro-Analytics/issues/new"',
    );
    expect(html).toMatch(
      /href="https:\/\/github\.com\/ctg-tme\/Cisco-Macro-Analytics\/issues\/new"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
  });

  it('offers persistent system, light, and dark color themes', () => {
    expect(html).toContain('id="theme-select"');
    expect(html).toContain('<option value="system">System</option>');
    expect(html).toContain('<option value="light">Light</option>');
    expect(html).toContain('<option value="dark">Dark</option>');
    expect(html).not.toContain('id="theme-button"');
    expect(main).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    expect(main).toContain("systemColorScheme.addEventListener('change'");
  });

  it('keeps the winter treatment seasonal and previewable', () => {
    expect(html).toContain('id="winter-snowfall"');
    expect(main).toContain("get('winter') === 'true'");
    expect(css).toContain('.winter-theme :is(');
    expect(css).toContain('url("/winter-light-row.svg")');
    expect(css).toContain('url("/winter-light-column.svg")');
    expect(css).toContain('.results-section .summary-card');
    expect(css).toContain('.results-section .reference-card');
    expect(css).not.toContain('winter-lights-live');
  });

  it('does not ask the author to choose a schema or device profile', () => {
    expect(html).not.toContain('id="schema-select"');
    expect(html).not.toContain('id="product-select"');
    expect(html).not.toContain('id="operating-mode"');
    expect(html).not.toContain('id="runtime-role"');
    expect(html).not.toContain('Refine schema comparison');
  });

  it('uses familiar result labels instead of internal analysis terminology', () => {
    expect(html).toContain('>Overview<');
    expect(html).toContain('>Entries &amp; Dependencies<');
    expect(html).toContain('>General Issues<');
    expect(html).toContain('>Android Issues<');
    expect(html).toContain('>xAPI References<');
    expect(html).toContain('>Raw JSON<');
    expect(html).not.toContain('Inspect the code.');
    expect(html).not.toContain('Keep the uncertainty.');
    expect(html).not.toContain('Claim mode');
    expect(html).not.toContain('Macro Diagnostics home');
  });

  it('presents result tabs as large, visibly interactive controls', () => {
    expect(css).toContain('.result-tabs button { min-height: 50px');
    expect(css).toContain('.result-tabs button:not([aria-selected="true"]):hover');
    expect(css).toContain('.result-tabs button:active');
    expect(css).toContain('border-radius: 9px 9px 0 0');
  });

  it('uses Android Container as the user-facing operating-mode term', () => {
    expect(html).toContain('Android Container schema availability');
    expect(html).toContain('Android Container refers to device deployments running Microsoft Teams Rooms or Zoom Rooms software on top of RoomOS');
    expect(html).not.toMatch(/>\s*MTR\s*</);
    expect(html).toContain('This is Microsoft Teams schema evidence, not a runtime test.');
    expect(html).toContain('A schema with no Android Container metadata is treated as not supporting the container.');
    expect(html).toContain('Conflicting evidence or a missing kind-specific convention in a metadata-bearing schema is reported as unknown.');
    expect(html).toContain('do not provide equivalent general availability metadata for Zoom Rooms');
  });

  it('keeps Android Container schema availability compact in the overview and its detail in the issues tab', () => {
    expect(main).toContain("summaryCard(\n      'Android Container schema availability'");
    expect(html).not.toContain('class="result-card android-readiness-card"');
    expect(html.indexOf('id="tab-android-container"')).toBeLessThan(
      html.indexOf('id="android-container-readiness-detail"'),
    );
    expect(main).toContain('elements.androidContainerReadinessDetail.innerHTML');
  });

  it('separates Cloud and On-premises version pills into two columns', () => {
    expect(main).toContain("label: 'Cloud'");
    expect(main).toContain("label: 'On-premises'");
    expect(main).toContain('Schema name includes a release month');
    expect(css).toContain('.version-channel-grid');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('describes schema availability without claiming software compatibility', () => {
    expect(main).toContain('All xAPI references available');
    expect(main).toContain('Schema Availability Range');
    expect(main).toContain('Oldest fully represented');
    expect(main).toContain('Newest fully represented');
    expect(main).toContain('Latest software');
    expect(main).toContain('latest?.id === coverage.latestCatalogVersion?.id');
    expect(main).toContain('newest ${channel.label} snapshot in the catalog');
    expect(main).not.toContain('Software Compatibility Range');
    expect(main).not.toContain('Oldest compatible');
    expect(main).not.toContain('Newest compatible');
    expect(main).toContain('Not available on these versions');
    expect(main).toContain('version.missingReferences');
    expect(main).toContain('The missing paths are listed with it.');
    expect(main).toContain('Schema absence means unavailable');
    expect(main).not.toContain('Could not determine on these versions');
  });

  it('keeps local source previews collapsed in both issue views', () => {
    expect(main).toContain('snippetSources.map((reference) => renderSourceSnippet(reference))');
    expect(main).toContain('referenceGroup.references.map(renderSourceOccurrence)');
    expect(main).toContain('<details class="source-snippet">');
    expect(main).not.toContain('<details class="source-snippet" open>');
    expect(main).not.toContain('maskSensitiveSourceLine');
    expect(css).toContain('.source-code-line.highlighted');
  });

  it('renders actionable Finding evidence without duplicating Source locations', () => {
    expect(main).toContain('function renderFindingRoutes(');
    expect(main).toContain('function renderFindingDependencyPaths(');
    expect(main).toContain('function renderCredentialTerms(');
    expect(main).toContain('function renderCanonicalFindingReference(');
    expect(main).toContain('data-finding-id="${escapeHtml(finding.id)}"');
    expect(main).toContain('xAPI binding routes');
    expect(main).toContain('Dependency paths');
    expect(main).toContain('Detected vocabulary matches');
    expect(main).toContain('Canonical xAPI reference');
    expect(main).not.toContain('function renderFindingLocations(');
    expect(main).not.toContain('Source locations');
    expect(css).toContain('.binding-route-list');
    expect(css).toContain('.credential-term-list');
  });

  it('puts analyzed Entry and dependency relationships in their own result tab', () => {
    const renderFiles = main.slice(
      main.indexOf('function renderFiles(): void'),
      main.indexOf('function resetAnalysis(): void'),
    );

    expect(html).toContain('id="macro-relationships"');
    expect(html).toContain('data-result-tab="relationships"');
    expect(html).toContain('id="tab-relationships"');
    expect(html.indexOf('id="tab-relationships"')).toBeGreaterThan(html.indexOf('id="tab-overview"'));
    expect(html.slice(
      html.indexOf('id="tab-overview"'),
      html.indexOf('id="tab-relationships"'),
    )).not.toContain('id="macro-relationships"');
    expect(main).toContain('function renderMacroRelationships(');
    expect(main).toContain("file.roles.includes('Entry')");
    expect(main).toContain('report.directDependencyGraph');
    expect(main).toContain('report.unresolvedDependencyEdges');
    expect(main).not.toContain('data-finding-scope="direct"');
    expect(main).toContain('data-finding-scope="dependency"');
    expect(renderFiles).toContain('active-badge ${selection.active ?');
    expect(renderFiles).not.toContain('role-badge entry');
    expect(renderFiles).not.toContain('role-badge dependency');
    expect(renderFiles).not.toContain('renderDependencyTree');
    expect(renderFiles).not.toContain('data-finding-scope');
    expect(css).toContain('.macro-relationships');
    expect(css).toContain('border: 1px dotted #8464c8');
  });

  it('opens a visual Dependency map from each Entry Macro', () => {
    expect(html).toContain('id="dependency-map-dialog"');
    expect(html).toContain('id="dependency-map-canvas"');
    expect(html).toContain('Domain · in use');
    expect(html).toContain('Domain · not in use');
    expect(main).toContain('data-dependency-map-entry=');
    expect(main).toContain('buildDependencyMap(report, entryFileId)');
    expect(main).toContain('buildDependencyMap(report, fileId).counts.dependencies');
    expect(main).toContain("dependencyCount === 0 ? ' disabled' : ''");
    expect(main).toContain('dependency-map-button-count');
    expect(main).toContain('renderDependencyMapSvg(model)');
    expect(main).toContain('elements.dependencyMapDialog.showModal()');
    expect(css).toContain('.dependency-map-button { width: 132px');
    expect(css).toContain('.dependency-map-button:disabled');
    expect(css).toContain('.dependency-map-button-count');
    expect(css).toContain('.dependency-map-svg');
    expect(css).toContain('width: min(1600px, calc(100vw - 24px))');
    expect(css).toContain('height: min(1100px, calc(100dvh - 24px))');
    expect(css).toContain('grid-template-rows: auto auto auto auto minmax(0, 1fr) auto');
    expect(css).toContain('.dependency-map-node.external');
    expect(css).toContain('.dependency-map-node.external.not-in-use');
    expect(css).toContain('.dependency-map-edge.external-url');
    expect(css).toContain('.dependency-map-edge.skip-level');
    expect(css).toContain('grid-template-columns: 28px minmax(120px, 1fr) 182px 276px');
    expect(css).toContain('.macro-relationship-badges { width: 182px; }');
    expect(css).toContain('.macro-impact-links { width: 276px;');
  });

  it('groups Findings by source macro instead of Review Priority', () => {
    expect(main).toContain('groupFindingsByMacro(');
    expect(main).toContain('macro-finding-section');
    expect(main).not.toContain('Findings by Review Priority');
    expect(html).toContain('General Issues grouped by macro');
    expect(css).toContain('.macro-finding-section');
  });

  it('groups Android Issues by source macro with collapsible issue details', () => {
    expect(main).toContain('groupAndroidContainerIssuesByMacro(');
    expect(html).toContain('Android Issues grouped by macro');
    expect(main).toContain('android-issue-section');
    expect(main).toContain('<details class="container-issue-card');
  });

  it('groups xAPI references by source macro with a list of paths in each group', () => {
    expect(main).toContain('groupReferencesByMacro(');
    expect(html).toContain('xAPI References grouped by macro');
    expect(main).toContain('macro-reference-section');
    expect(main).toContain('macroGroup.referenceGroups.map(renderReferenceCard)');
    expect(css).toContain('.macro-reference-section');
    expect(css).toContain('.macro-reference-content');
  });

  it('shows subscription-specific analytics without replacing general xAPI counts', () => {
    expect(main).toContain("'Subscription registrations'");
    expect(main).toContain('subscriptions.totalRegistrations');
    expect(main).toContain('subscriptions.uniqueSubscribedPaths');
    expect(main).toContain('subscriptions.byBranch[kind]');
    expect(main).toContain("'xAPI references'");
    expect(main).toContain("'Unique xAPI paths'");
  });

  it('renders, copies, and exports the same canonical cross-schema session', () => {
    expect(html).toContain('Analysis Session 1.0.0');
    expect(main).toContain('buildAnalysisSession({');
    expect(main).toContain('deriveAnalysisSessionPresentation(session)');
    expect(main).toContain('JSON.stringify(session, null, 2)');
    expect(main).toContain('JSON.stringify(state.analysis, null, 2)');
    expect(main).not.toContain('const exportData = primaryReport');
    expect(main).toContain('document.body.append(link)');
    expect(main).toContain('link.remove()');
    expect(main).toContain('window.setTimeout(() => URL.revokeObjectURL(url), 0)');
  });

  it('omits empty Parent branch and Not found coverage sections from xAPI cards', () => {
    expect(main).toMatch(
      /coverage\.parentVersions\.length > 0\s+\? referenceVersionGroup\(\s+'Parent branch'/,
    );
    expect(main).toMatch(
      /coverage\.missingVersions\.length > 0\s+\? referenceVersionGroup\(\s+'Not found'/,
    );
  });

  it('keeps large macro sets out of the primary input layout', () => {
    expect(html).toContain('id="macro-list-button"');
    expect(html).toContain('id="macro-list-dialog"');
    expect(html.indexOf('id="macro-list-dialog"')).toBeGreaterThan(html.indexOf('</main>'));
    expect(main).toContain('elements.macroListDialog.showModal()');
    expect(css).toContain('.macro-list-dialog .file-list-wrap');
    expect(css).toContain('overflow-y: auto');
  });

  it('keeps an analysis failure visible while allowing a retry', () => {
    expect(main).toContain('analysisError?: string;');
    expect(main).toContain('if (state.analysisError)');
    expect(main).toContain('state.analysisError = error instanceof Error');
    expect(main).toContain("state.analysisError ? 'alert' : 'status'");
  });

  it('shows determinate progress while RoomOS schemas are evaluated', () => {
    expect(html).toContain('id="analysis-progress" hidden');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="RoomOS schema evaluation progress"');
    expect(main).toContain('showAnalysisProgress(0, catalog.snapshots.length)');
    expect(main).toContain('showAnalysisProgress(index + 1, catalog.snapshots.length)');
    expect(main).toContain('hideAnalysisProgress();');
    expect(css).toContain('.analysis-progress-track i');
    expect(css).toContain('transition: width .2s ease');
  });
});
