"""Build the ontology layer on top of the sampled warehouse tables.

Foundry's central idea is that a business does not want tables, it wants
*objects* -- Author, Work, Passage -- with typed properties and links between
them, and a visible trail back to the data that produced them.  This module
writes that metadata into the same SQLite file so the app can be generic: the
UI renders whatever object types it finds here rather than hard-coding three.
"""

from __future__ import annotations

import datetime as dt

DDL = """
CREATE TABLE IF NOT EXISTS sample_runs (
    id           INTEGER PRIMARY KEY,
    created_at   TEXT,
    population_n INTEGER,
    sample_n     INTEGER,
    fraction     REAL,
    seed         INTEGER,
    method       TEXT
);

CREATE TABLE IF NOT EXISTS authors (
    id               INTEGER PRIMARY KEY,
    name             TEXT UNIQUE,
    work_count       INTEGER DEFAULT 0,
    passage_count    INTEGER DEFAULT 0,
    primary_language TEXT,
    primary_corpus   TEXT,
    languages        TEXT,
    corpora          TEXT
);

CREATE TABLE IF NOT EXISTS object_types (
    api_name      TEXT PRIMARY KEY,
    display_name  TEXT,
    plural_name   TEXT,
    icon          TEXT,
    color         TEXT,
    backing_table TEXT,
    primary_key   TEXT,
    title_column  TEXT,
    description   TEXT,
    object_count  INTEGER DEFAULT 0,
    sort_order    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS object_properties (
    object_type  TEXT REFERENCES object_types(api_name),
    api_name     TEXT,
    display_name TEXT,
    data_type    TEXT,
    role         TEXT,          -- title | subtitle | metric | body | facet | plain
    searchable   INTEGER DEFAULT 0,
    sort_order   INTEGER DEFAULT 0,
    PRIMARY KEY (object_type, api_name)
);

CREATE TABLE IF NOT EXISTS link_types (
    api_name     TEXT PRIMARY KEY,
    display_name TEXT,
    inverse_name TEXT,
    source_type  TEXT,
    target_type  TEXT,
    cardinality  TEXT,
    source_key   TEXT,
    target_key   TEXT,
    description  TEXT
);

CREATE TABLE IF NOT EXISTS datasets (
    rid         TEXT PRIMARY KEY,
    name        TEXT,
    layer       TEXT,           -- raw | clean | sample | ontology
    kind        TEXT,
    row_count   INTEGER,
    description TEXT
);

CREATE TABLE IF NOT EXISTS lineage_edges (
    source_rid TEXT,
    target_rid TEXT,
    transform  TEXT,
    description TEXT,
    PRIMARY KEY (source_rid, target_rid)
);

CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name);
"""
# Perseus author statements carry stray leading punctuation (">Catenae", "*Homer").
# Normalise once, here, so the Author->Work join still matches on the clean name.
AUTHOR_EXPR = ("COALESCE(NULLIF(TRIM(TRIM({t}.author), ' >*.,;:[]()'), ''),"
               " 'Anonymous / unattributed')")


VIEWS = """
DROP VIEW IF EXISTS obj_Author;
DROP VIEW IF EXISTS obj_Work;
DROP VIEW IF EXISTS obj_Passage;

-- One flat, denormalised view per object type. The API is generic over these:
-- it reads object_types/object_properties and queries whatever view it finds,
-- so adding an object type is a metadata change, not a code change.
CREATE VIEW obj_Author AS
    SELECT id, name, work_count, passage_count, primary_language, primary_corpus,
           languages, corpora
      FROM authors;

CREATE VIEW obj_Work AS
    SELECT edition_urn, title,
           COALESCE(NULLIF(TRIM(TRIM(author), ' >*.,;:[]()'), ''),
                    'Anonymous / unattributed') AS author,
           language, corpus, edition_label, editor,
           published, citation_scheme, passage_count, work_urn, textgroup_urn
      FROM works;

CREATE VIEW obj_Passage AS
    SELECT p.id, p.ref, p.text, p.n_words, p.n_chars, p.edition_urn,
           w.title AS work_title,
           COALESCE(NULLIF(TRIM(TRIM(w.author), ' >*.,;:[]()'), ''),
                    'Anonymous / unattributed') AS author,
           w.language, w.corpus
      FROM passages p JOIN works w ON w.edition_urn = p.edition_urn;
"""

OBJECT_TYPES = [
    # api_name, display, plural, icon, color, table, pk, title, description, order
    ("Author", "Author", "Authors", "person", "#7961db", "obj_Author", "id", "name",
     "A classical author attested in the corpus. Derived by normalising the "
     "author statement on every edition.", 1),
    ("Work", "Work", "Works", "book", "#147eb3", "obj_Work", "edition_urn", "title",
     "One edition of one work, addressed by its CTS URN. The unit a scholar "
     "cites and a publisher licenses.", 2),
    ("Passage", "Passage", "Passages", "paragraph", "#238551", "obj_Passage", "id", "ref",
     "The smallest citable unit of text -- a verse line or a prose section. "
     "The grain of the sampled dataset.", 3),
]

PROPERTIES = {
    "Author": [
        ("name", "Name", "string", "title", 1),
        ("work_count", "Works", "integer", "metric", 0),
        ("passage_count", "Passages", "integer", "metric", 0),
        ("primary_language", "Language", "string", "facet", 0),
        ("primary_corpus", "Corpus", "string", "facet", 0),
        ("languages", "All languages", "string", "plain", 0),
        ("corpora", "All corpora", "string", "plain", 0),
    ],
    "Work": [
        ("title", "Title", "string", "title", 1),
        ("author", "Author", "string", "subtitle", 1),
        ("language", "Language", "string", "facet", 0),
        ("corpus", "Corpus", "string", "facet", 0),
        ("edition_label", "Edition", "string", "plain", 1),
        ("editor", "Editor", "string", "plain", 1),
        ("published", "Published", "string", "plain", 0),
        ("citation_scheme", "Citation scheme", "string", "plain", 0),
        ("passage_count", "Passages", "integer", "metric", 0),
        ("edition_urn", "CTS URN", "string", "plain", 1),
    ],
    "Passage": [
        ("ref", "Citation", "string", "title", 0),
        ("work_title", "Work", "string", "subtitle", 1),
        ("author", "Author", "string", "facet", 1),
        ("text", "Text", "text", "body", 1),
        ("language", "Language", "string", "facet", 0),
        ("corpus", "Corpus", "string", "facet", 0),
        ("n_words", "Words", "integer", "metric", 0),
        ("n_chars", "Characters", "integer", "metric", 0),
        ("edition_urn", "CTS URN", "string", "plain", 1),
    ],
}

LINK_TYPES = [
    # api_name, forward label, reverse label, source, target, cardinality, keys, doc
    ("author_wrote_work", "wrote", "written by", "Author", "Work", "ONE_TO_MANY",
     "name", "author", "Attribution of an edition to its author."),
    ("work_contains_passage", "contains", "part of", "Work", "Passage", "ONE_TO_MANY",
     "edition_urn", "edition_urn", "Every citable passage belongs to exactly one edition."),
]


def _rid(name: str) -> str:
    return f"ri.foundry-smb.dataset.{name}"


def build(conn, population: int, sample_n: int, seed: int) -> None:
    conn.executescript(DDL)

    for table in ("sample_runs", "authors", "object_types", "object_properties",
                  "link_types", "datasets", "lineage_edges"):
        conn.execute(f"DELETE FROM {table}")

    conn.execute(
        "INSERT INTO sample_runs(created_at,population_n,sample_n,fraction,seed,method)"
        " VALUES (?,?,?,?,?,?)",
        (dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
         population, sample_n, sample_n / population if population else 0, seed,
         "simple random sample without replacement"))

    # --- Author objects, derived from the works in the sample --------------
    conn.execute(f"""
        INSERT INTO authors(name, work_count, passage_count, primary_language,
                            primary_corpus, languages, corpora)
        WITH normed AS (
            SELECT {AUTHOR_EXPR.format(t='w')} AS name, w.edition_urn,
                   w.language, w.corpus, w.passage_count
              FROM works w
        )
        SELECT n.name,
               COUNT(DISTINCT n.edition_urn),
               COALESCE(SUM(n.passage_count), 0),
               (SELECT a.language FROM normed a WHERE a.name = n.name
                 GROUP BY a.language ORDER BY SUM(a.passage_count) DESC LIMIT 1),
               (SELECT a.corpus FROM normed a WHERE a.name = n.name
                 GROUP BY a.corpus ORDER BY SUM(a.passage_count) DESC LIMIT 1),
               (SELECT GROUP_CONCAT(DISTINCT a.language) FROM normed a WHERE a.name = n.name),
               (SELECT GROUP_CONCAT(DISTINCT a.corpus) FROM normed a WHERE a.name = n.name)
          FROM normed n GROUP BY n.name
    """)

    # --- Full-text search over the sampled passages ------------------------
    conn.execute("DROP TABLE IF EXISTS passages_fts")
    conn.execute("CREATE VIRTUAL TABLE passages_fts USING fts5("
                 "text, ref UNINDEXED, content='passages', content_rowid='id')")
    conn.execute("INSERT INTO passages_fts(rowid, text, ref)"
                 " SELECT id, text, ref FROM passages")

    conn.executescript(VIEWS)

    counts = {
        "Author": conn.execute("SELECT COUNT(*) FROM authors").fetchone()[0],
        "Work": conn.execute("SELECT COUNT(*) FROM works").fetchone()[0],
        "Passage": conn.execute("SELECT COUNT(*) FROM passages").fetchone()[0],
    }

    conn.executemany(
        "INSERT INTO object_types(api_name,display_name,plural_name,icon,color,"
        "backing_table,primary_key,title_column,description,object_count,sort_order)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(a, d, p, i, c, t, pk, ti, desc, counts[a], o)
         for a, d, p, i, c, t, pk, ti, desc, o in OBJECT_TYPES])

    conn.executemany(
        "INSERT INTO object_properties(object_type,api_name,display_name,data_type,"
        "role,searchable,sort_order) VALUES (?,?,?,?,?,?,?)",
        [(ot, api, disp, dtype, role, search, idx)
         for ot, props in PROPERTIES.items()
         for idx, (api, disp, dtype, role, search) in enumerate(props)])

    conn.executemany(
        "INSERT INTO link_types(api_name,display_name,inverse_name,source_type,"
        "target_type,cardinality,source_key,target_key,description)"
        " VALUES (?,?,?,?,?,?,?,?,?)", LINK_TYPES)

    # --- Datasets and lineage ---------------------------------------------
    corpora = conn.execute(
        "SELECT key, label, editions, passages FROM corpora").fetchall()

    datasets = []
    for key, label, editions, upstream in corpora:
        datasets.append((
            _rid(key), key, "raw", "TEI/XML", editions,
            f"{label} — {editions:,} EpiDoc TEI editions holding {upstream:,} "
            f"citable passages, cloned from GitHub."))
    datasets += [
        (_rid("works"), "works", "clean", "table", counts["Work"],
         "One row per edition represented in the sample, with header metadata "
         "and citation scheme."),
        (_rid("passages_full"), "passages_full", "clean", "table", population,
         "Every citable passage in the corpus — the sampling frame."),
        (_rid("passages_sample"), "passages_sample", "sample", "table", sample_n,
         f"Seeded random sample of {sample_n:,} passages drawn from "
         f"{population:,} (seed {seed})."),
        (_rid("authors"), "authors", "ontology", "object", counts["Author"],
         "Author objects derived from edition author statements."),
        (_rid("passages_fts"), "passages_fts", "ontology", "index", sample_n,
         "FTS5 full-text index backing search in the Object Explorer."),
    ]
    conn.executemany(
        "INSERT INTO datasets(rid,name,layer,kind,row_count,description)"
        " VALUES (?,?,?,?,?,?)", datasets)

    edges = [(_rid(row[0]), _rid("works"), "tei.parse_file",
              "EpiDoc header → work metadata") for row in corpora]
    edges += [(_rid(row[0]), _rid("passages_full"), "tei.parse_file",
               "Citation walk → one row per citable unit") for row in corpora]
    edges += [
        (_rid("passages_full"), _rid("passages_sample"),
         "sample.draw_ids", f"Uniform SRS without replacement, seed {seed}"),
        (_rid("works"), _rid("authors"), "ontology.build",
         "Normalise + group author statements"),
        (_rid("passages_sample"), _rid("passages_fts"), "fts5.index",
         "Build the search index over sampled text"),
        (_rid("passages_sample"), _rid("authors"), "ontology.build",
         "Roll passage counts up to the author object"),
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO lineage_edges(source_rid,target_rid,transform,description)"
        " VALUES (?,?,?,?)", edges)
