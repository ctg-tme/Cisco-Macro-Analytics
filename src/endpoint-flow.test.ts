import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = projectFile('index.html');
const main = projectFile('src/main.ts');
const recentDevices = projectFile('src/endpoint/recentDevices.ts');

function functionSource(name: string, nextName: string): string {
  return main.slice(main.indexOf(`function ${name}`), main.indexOf(`function ${nextName}`));
}

describe('Connect Endpoint flow', () => {
  it('presents local upload and endpoint retrieval as adjacent macro-source choices', () => {
    const uploadSection = html.slice(
      html.indexOf('aria-labelledby="upload-title"'),
      html.indexOf('aria-labelledby="scope-title"'),
    );
    const topActions = html.slice(
      html.indexOf('<nav class="top-actions"'),
      html.indexOf('</nav>'),
    );

    expect(uploadSection).toContain('id="endpoint-button"');
    expect(uploadSection).toContain('Choose one source for the macro set.');
    expect(uploadSection).toContain('Upload from this computer');
    expect(uploadSection).toContain('id="source-divider"');
    expect(uploadSection).toContain('Connect to a RoomOS endpoint');
    expect(uploadSection).toContain('Other options');
    expect(uploadSection.indexOf('id="drop-zone"')).toBeLessThan(
      uploadSection.indexOf('id="source-divider"'),
    );
    expect(uploadSection.indexOf('id="source-divider"')).toBeLessThan(
      uploadSection.indexOf('id="endpoint-source"'),
    );
    expect(uploadSection.indexOf('id="endpoint-source"')).toBeLessThan(
      uploadSection.indexOf('id="manual-source-actions"'),
    );
    expect(topActions).not.toContain('id="endpoint-button"');
  });

  it('collects only the required connection fields in a modal', () => {
    expect(html).toContain('id="endpoint-button"');
    expect(html).toContain('id="endpoint-dialog"');
    expect(html).toMatch(/id="endpoint-host"[^>]+required/);
    expect(html).toMatch(/id="endpoint-username"[^>]+required/);
    expect(html).toMatch(/id="endpoint-password"[^>]+required/);
    expect(html).toContain('Connect and review macros');
  });

  it('switches the analyzer to endpoint-only source controls until disconnect', () => {
    expect(main).toContain('macros = await getEndpointMacros(xapi)');
    expect(main).toContain('state.files = endpointMacroSelections(macros)');
    expect(main).toContain('elements.fileInput.disabled = connected');
    expect(main).toContain('elements.dropZone.hidden = connected');
    expect(main).toContain('elements.sourceDivider.hidden = connected');
    expect(main).toContain('elements.manualSourceActions.hidden = connected');
    expect(main).toContain('if (state.endpoint) return;');
    expect(main).toContain('endpoint.xapi.close()');
    expect(main).toContain('state.files = []');
  });

  it('remembers only successful endpoint identities for quick address selection', () => {
    expect(html).toContain('id="recent-endpoints"');
    expect(html).toContain('id="recent-endpoint-list"');
    expect(html).toContain('Recent endpoints');
    expect(main).toContain('broadcastName = await getEndpointBroadcastName(xapi)');
    expect(main).toContain('saveRecentEndpoint({ host, broadcastName })');
    expect(main.indexOf('xapi = await connectToEndpoint(credentials)')).toBeLessThan(
      main.indexOf('saveRecentEndpoint({ host, broadcastName })'),
    );
    expect(recentDevices).toContain('MAX_RECENT_ENDPOINTS = 5');
    expect(recentDevices).toContain('host: string;');
    expect(recentDevices).toContain('broadcastName: string;');
    expect(recentDevices).not.toContain('username: string;');
    expect(recentDevices).not.toContain('password: string;');
  });

  it('opens Macro list review after either source flow without starting analysis', () => {
    const uploadFlow = functionSource('addBrowserFiles', 'loadExample');
    const connectFlow = functionSource('connectEndpoint', 'disconnectEndpoint');

    expect(uploadFlow).toContain('elements.macroListDialog.showModal()');
    expect(connectFlow).toContain('elements.macroListDialog.showModal()');
    expect(connectFlow).not.toContain('runAnalysis(');
    expect(html).toContain('Analysis begins only when you select “Analyze macro”');
  });

  it('includes every endpoint macro by default and infers graph roots later', () => {
    const endpointSelections = functionSource('endpointMacroSelections', 'clearEndpointDialogError');

    expect(endpointSelections).toContain('included: true');
    expect(endpointSelections).not.toContain('entry: true');
  });

  it('offers bulk selection controls in the shared Macro list', () => {
    expect(html).toContain('id="macro-select-all"');
    expect(html).toContain('id="macro-clear-all"');
    expect(html).toContain('Include all');
    expect(html).toContain('Exclude all');
    expect(main).toContain('setAllMacrosIncluded(true)');
    expect(main).toContain('setAllMacrosIncluded(false)');
    expect(main).toContain('buildIncludedMacroSet(state.files)');
    expect(html).toContain('Choose which files to include in analysis.');
    expect(html).toContain('Unchecked files are excluded from parsing');
    expect(html).not.toContain('Starts analysis');
  });

  it('keeps endpoint-derived source local and credentials out of the recent-device cache', () => {
    expect(html).toMatch(/connect-src 'self' [^"]*https:\/\/us\.aptabase\.com [^"]*https:\/\/eu\.aptabase\.com [^"]*wss:/);
    expect(html).toContain('Endpoint source remains in browser memory only.');
    expect(html).toContain('Usernames and passwords are never saved');
    expect(html).toContain('The JSON files inside ZIP exports omit the original source text.');
    expect(main).not.toContain('localStorage');
    expect(main).not.toContain('sessionStorage');
  });
});
