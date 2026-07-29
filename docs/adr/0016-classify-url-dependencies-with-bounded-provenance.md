# Classify URL dependencies with bounded provenance

The Macro Analyzer will classify each statically detected URL occurrence with a three-state URL Usage model: In Use, Use Unknown, or Not In Use. It will prove In Use when a versioned, allowlisted source path carries the value anywhere inside an argument to a proven xAPI Touchpoint, or when structurally recognized executable XML independently implies xAPI-bound use in the closed RoomOS Macro runtime. It will report Use Unknown when a path escapes the supported analysis boundary. It will report Not In Use only after every explicit path is proven to terminate without xAPI use.

This decision replaces the earlier direct-containment test that only recognized URL literals physically nested in xAPI arguments. That test produced false negatives for ordinary macro configurations that stage values in arrays or objects and later pass reconstructed or serialized structures to xAPI.

URL provenance is structural and independent of author-chosen identifiers or property names. The initial allowlist covers ordinary immutable value movement, recoverable callbacks, selected non-mutating array and string helpers, JSON serialization, and resolved module crossings. Unsupported calls, content-changing transforms, mutation, missing consumers, and unresolved dependencies remain opaque. A statically possible supported route is sufficient for In Use without claiming that its branch or callback executed.

External Dependency identity uses a normalized hostname or IP literal plus any explicitly authored port, with protocol retained separately. Each URL token remains an occurrence with its own Source Reference and explanation. Destination aggregation uses In Use over Use Unknown over Not In Use, while retaining lower-priority occurrences for inspection.

Comment URLs are separate Commented URL evidence rather than External Dependencies. They are Not In Use, hidden by default, and excluded from dependency status and totals. Dynamic-host expressions remain Dynamic URL evidence rather than being grouped under a guessed destination; executable XML may still independently prove their use.

The tradeoff is a deliberately bounded model: it accepts conservative Use Unknown results where general JavaScript evaluation might infer more, in exchange for auditable explanations and avoiding unsupported runtime claims. Expanding the allowlist changes analysis semantics and therefore requires versioned report/analyzer provenance and regression fixtures.
