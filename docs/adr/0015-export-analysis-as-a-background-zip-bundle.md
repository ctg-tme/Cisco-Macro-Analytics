# Export analysis as a background ZIP bundle

The Macro Analyzer will not render or copy the complete Analysis Session Result in the interface. A single **Export** action opens an output chooser and prompts for an editable report name. Manual analysis defaults to `macro_analysis_DATE`; Endpoint-sourced analysis includes its filesystem-safe broadcast name as `macro_analysis_ENDPOINT_DATE`.

The **Export Analysis JSON** option packages `full-analysis.json`, containing the complete canonical session, with one source-free JSON analysis projection per submitted Macro under `independent-macro-analysis/`. Each projection is named `MACRO_analysis.json`; a numeric suffix is added only when duplicate Macro basenames would otherwise overwrite one another. A disabled **Export Report** placeholder reserves the human-readable output without implying a format before that report is designed.

ZIP preparation runs in a dedicated browser worker. This removes the large formatted JSON text node and its layout cost from ordinary result viewing, and keeps JSON serialization and ZIP compression away from the interface thread. The canonical Analysis Session Result still remains in browser memory because the result interface and export both depend on it, and an explicit export still needs temporary memory while the archive is prepared.

The bundle never includes submitted JavaScript source. Per-Macro files retain source-safe inventory, observations, Findings, xAPI references, relationships, schema provenance, Rule Pack context, and Source References so they remain useful projections without becoming competing canonical reports.

The analyzer accepts `full-analysis.json` as an alternate results input. Import validation and JSON parsing run in a browser worker, verified schema provenance and each Analysis Report contract are checked, and the saved session is rendered without running analysis again. Imported sessions cannot show local source previews because source is intentionally absent. Files under `independent-macro-analysis/` are rejected because they cannot reconstruct the complete cross-schema interface.
