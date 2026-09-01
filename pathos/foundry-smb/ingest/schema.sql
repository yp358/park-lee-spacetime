-- Local warehouse for the classical-text corpus.
-- Mirrors the Foundry split: raw provenance, curated entities, ontology objects.

CREATE TABLE IF NOT EXISTS corpora (
    key         TEXT PRIMARY KEY,
    repo        TEXT NOT NULL,
    namespace   TEXT NOT NULL,
    label       TEXT NOT NULL,
    revision    TEXT,
    license     TEXT,
    editions    INTEGER DEFAULT 0,   -- TEI files parsed from this corpus
    passages    INTEGER DEFAULT 0    -- citable passages it contributed
);

CREATE TABLE IF NOT EXISTS ingest_runs (
    id              INTEGER PRIMARY KEY,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    source_kind     TEXT,
    source_endpoint TEXT,
    probe_report    TEXT,
    editions        INTEGER DEFAULT 0,
    passages        INTEGER DEFAULT 0,
    unparsed        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS works (
    edition_urn     TEXT PRIMARY KEY,
    work_urn        TEXT NOT NULL,
    textgroup_urn   TEXT NOT NULL,
    corpus          TEXT NOT NULL,
    author          TEXT,
    title           TEXT,
    edition_label   TEXT,
    language        TEXT,
    editor          TEXT,
    published       TEXT,
    citation_scheme TEXT,
    source_path     TEXT,
    passage_count   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS passages (
    id          INTEGER PRIMARY KEY,
    edition_urn TEXT NOT NULL REFERENCES works(edition_urn),
    ref         TEXT NOT NULL,
    text        TEXT NOT NULL,
    n_words     INTEGER NOT NULL,
    n_chars     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passages_edition ON passages(edition_urn);
CREATE INDEX IF NOT EXISTS idx_works_author     ON works(author);
CREATE INDEX IF NOT EXISTS idx_works_language   ON works(language);
CREATE INDEX IF NOT EXISTS idx_works_corpus     ON works(corpus);
