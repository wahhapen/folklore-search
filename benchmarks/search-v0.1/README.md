# Search Benchmark v0.1

This incubation benchmark contains 18 deliberately small, hand-written English
queries: 16 positive information needs and two out-of-corpus probes. Positive
queries cover exact titles, distinctive entities, remembered situations, and
plot/theme paraphrases.

Judgments were made by reading the named source documents in Corpus Release
v0.1.0. Relevance is currently document-level and binary in practice (grade 3
for the one intended source document). The retriever ranks Passages, then
exposes the best Passage for each Document so every result remains citable.

This benchmark is suitable for debugging a first lexical baseline. It is too
small and too narrow to select or promote an embedding model. It currently has
no multilingual, misspelling, variant-family, facet, or multi-relevant-document
slice and no second reviewer or adjudication record.

Before model selection, expand to at least 50 independently reviewed queries,
add passage-level graded judgments and reviewer metadata, and include explicit
variant, multilingual, misspelling, and source-view checks. Preserve v0.1 as a
frozen historical run rather than silently rewriting its scores.

The two negative probes use exactly the same retrieval policy as interactive
search. This lexical baseline has no calibrated abstention layer and returns a
partial match for both probes; the committed negative-abstention score is
therefore 0.0.
