# Use one compact source review for all issues

Every canonical Finding and Android Container issue that has local source evidence uses the same compact review queue. The interface presents one deduplicated source location at a time with previous and next navigation instead of rendering every source preview together. A Macro Author may dismiss the current issue or restore dismissed issues; the dismiss action is adjacent to source navigation so the review can continue without moving between control groups.

Dismissal is reversible, exists only in the current local analysis review, resets when a new analysis starts, and never changes the canonical analysis result or its export. Source text remains local and is not added to an Analysis Report export.

This generalizes the authentication-specific presentation established in ADR 0014 without changing Finding identities, Android Container availability classifications, Source References, or analysis provenance.
