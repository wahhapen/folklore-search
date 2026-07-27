# Search v0.1 failure analysis

## Positive-query failures

### theme-01: man happily trades away everything until he has nothing

- Expected: Hans In Luck (fa:document:pg-2591:toc-002)
- Relevant rank: 33
- Relevant passage: fa:passage:pg-2591:toc-002:text-en:p0007
- Top result: Nix Nought Nothing (fa:passage:pg-7439:toc-007:text-en:p0001)
- Query terms present in relevant passage: man, away, he, has
- Query terms absent from relevant passage: happily, trade, everyth, until, noth

**Diagnosis.** The paraphrase shares too little edition vocabulary with the relevant passage for lexical ranking.

**Relevant evidence.** 'Well,' said the shepherd, 'if you are so fond of her, I will change my cow for your horse; I like to do good to my neighbours, even though I lose by it myself.' 'Done!' said Hans, merrily. 'What a noble heart that good man has!' thought he. Then the shepherd jumped upon the horse, wished Hans and t

**Next experiment.** Expand this failure slice with independently judged paraphrases, then compare a multilingual dense encoder and reciprocal-rank fusion against the frozen BM25F run.

### theme-03: animal companion repeatedly warns hero against bad choices on quest

- Expected: The Golden Bird (fa:document:pg-2591:toc-001)
- Relevant rank: not retrieved
- Relevant passage: none
- Top result: The Story-Teller At Fault (fa:passage:pg-7885:toc-016:text-en:p0012)
- Query terms present in relevant passage: none
- Query terms absent from relevant passage: animal, companion, repeatedly, warn, hero, against, bad, choice, quest

**Diagnosis.** The paraphrase shares too little edition vocabulary with the relevant passage for lexical ranking.

**Relevant evidence.** No relevant passage entered the ranked set.

**Next experiment.** Expand this failure slice with independently judged paraphrases, then compare a multilingual dense encoder and reciprocal-rank fusion against the frozen BM25F run.

## Negative-query failures

### negative-01: vampire space station

- Production-equivalent abstention outcome: did not abstain
- Benchmark top-20 results: 10
- Top result: The Bamboo-Cutter And The Moon-Child (fa:passage:pg-4018:toc-008:text-en:p0050)
- Matched terms: 1
- Score: 8.726659

**Diagnosis.** The lexical retriever has no calibrated abstention policy. A partial term match is enough to return a result.

### negative-02: Baba Yaga iron rocket

- Production-equivalent abstention outcome: did not abstain
- Benchmark top-20 results: 20
- Top result: Iron Hans (fa:passage:pg-2591:toc-062:text-en:p0014)
- Matched terms: 1
- Score: 31.333862

**Diagnosis.** The lexical retriever has no calibrated abstention policy. A partial term match is enough to return a result.
