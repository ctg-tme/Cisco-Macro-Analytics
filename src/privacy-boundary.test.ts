import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('local analysis boundary', () => {
  it('keeps the pure analysis core independent of browser and network globals', () => {
    const core = [
      'src/analysis/analyzeMacroSet.ts',
      'src/analysis/internal/importGraph.ts',
      'src/analysis/internal/parser.ts',
      'src/analysis/internal/schemaMatcher.ts',
    ].map(projectFile).join('\n');

    expect(core).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|document|window|navigator|localStorage)\b/);
    expect(core).not.toMatch(/Date\.now\(|new Date\(/);
  });

  it('loads executable assets from the application origin under a restrictive CSP', () => {
    const html = projectFile('index.html');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).not.toMatch(/<(script|link)[^>]+(?:src|href)=["']https?:\/\//i);
    expect(html).toContain('connect-src');
    expect(html).toContain('https://us.aptabase.com');
    expect(html).toContain('https://eu.aptabase.com');
    expect(html).not.toMatch(/google-analytics|segment\.com/i);
  });

  it('discloses the closed Product Telemetry boundary', () => {
    const html = projectFile('index.html');
    const main = projectFile('src/main.ts');
    const telemetry = projectFile('src/analytics/productTelemetry.ts');

    expect(html).toContain('Anonymous Aptabase Product Telemetry');
    expect(html).toContain('It never includes Macro names, source content, Endpoint identity or address, credentials, Declared Targets, or report findings.');
    expect(main).not.toContain('trackEvent(');
    expect(telemetry).toContain("'endpoint_connected' | 'manual_macros_loaded' | 'macro_analysis_completed'");
    expect(telemetry).toContain('macrosWithImportOrExportSyntax');
  });

  it('loads local and public app keys without requiring either one', () => {
    const gitignore = projectFile('.gitignore');
    const localExample = projectFile('.env.local.example');
    const workflow = projectFile('.github/workflows/deploy-page.yml');

    expect(gitignore).toContain('.env.local');
    expect(localExample).toContain('VITE_APTABASE_APP_KEY=');
    expect(workflow).toContain('VITE_APTABASE_APP_KEY: ${{ secrets.APTABASE_API_KEY }}');
    expect(workflow).not.toContain('aptabase_api_key_placeholder');
    expect(workflow).not.toMatch(/APTABASE_API_KEY[^]*exit 1/);
  });
});
