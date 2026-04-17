-- Plexus v5 — Full-Text Search Indexes
-- Migration: 0006_fts
--
-- Replaces the CONTAINS-based search in EntityRepository.search() with a
-- proper BM25-ranked full-text index. This is the "real FTS" that the
-- comment in entities.ts:468 was punting to Schritt 4b — we're doing it
-- now so the dashboard search scales beyond a few thousand entities and
-- so we get proper relevance ranking instead of lexicographic ordering.
--
-- Design decisions:
--   - One index per field (title + body) instead of a multi-field index.
--     This lets us weight title matches higher than body matches in the
--     scoring formula (title gets 2x body's BM25 score). A single
--     multi-field index would collapse both into one score.
--   - Analyzer is language-agnostic: `class` tokenizer (splits on char
--     class transitions, handles whitespace and most separators),
--     `lowercase` filter (case-insensitive matching), `ascii` filter
--     (Unicode-to-ASCII folding — `ü` matches `u`, `ß` matches `ss`,
--     etc.). No stemming, because the content is mixed DE/EN and a
--     language-specific stemmer would bias one over the other.
--   - HIGHLIGHTS enabled on both indexes so we can use
--     search::highlight() to wrap matched terms in <mark> tags in the
--     dashboard preview later. Costs a bit more storage; the tradeoff
--     is worth it for the UX.
--
-- Performance note: SurrealDB builds the index synchronously on
-- CREATE, so the first startup after this migration will pay the
-- one-time indexing cost for all existing entities. For our current
-- size (~160 rows) that's milliseconds. For 1M rows it would take
-- longer but is still a single startup hit.

DEFINE ANALYZER IF NOT EXISTS plexus_text
  TOKENIZERS blank, class
  FILTERS lowercase, ascii;

DEFINE INDEX IF NOT EXISTS entities_title_search
  ON entities
  FIELDS title
  SEARCH ANALYZER plexus_text BM25 HIGHLIGHTS;

DEFINE INDEX IF NOT EXISTS entities_body_search
  ON entities
  FIELDS body
  SEARCH ANALYZER plexus_text BM25 HIGHLIGHTS;
