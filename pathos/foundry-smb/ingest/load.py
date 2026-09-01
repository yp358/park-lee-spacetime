#!/usr/bin/env python3
"""Load the classical-text corpus into the local SQLite warehouse.

    python3 -m ingest.load --db data/classical_full.db

Resolves a connector (see ``sources.py``), parses every TEI edition it exposes,
and writes works + passages plus a provenance row describing the run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import sources  # noqa: E402
import tei  # noqa: E402

DEFAULT_VENDOR = os.path.abspath(os.path.join(HERE, "..", "..", "..", "vendor"))
DEFAULT_DB = os.path.abspath(os.path.join(HERE, "..", "data", "classical_full.db"))
BATCH = 5000

LICENSES = {
    "canonical-greekLit": "CC BY-SA 4.0 (Perseus Digital Library)",
    "canonical-latinLit": "CC BY-SA 4.0 (Perseus Digital Library)",
    "First1KGreek": "CC BY-SA 4.0 (Open Greek and Latin)",
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def connect(path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(open(os.path.join(HERE, "schema.sql"), encoding="utf-8").read())
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    return conn


def register_corpora(conn, source) -> None:
    rows = []
    for key, repo, ns, label in sources.CORPORA:
        revision = source.revision(key) if hasattr(source, "revision") else ""
        rows.append((key, repo, ns, label, revision, LICENSES.get(key, "")))
    conn.executemany(
        "INSERT OR REPLACE INTO corpora(key,repo,namespace,label,revision,license)"
        " VALUES (?,?,?,?,?,?)", rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--vendor", default=DEFAULT_VENDOR)
    ap.add_argument("--prefer", choices=["git", "cts", "raw"], default=None)
    ap.add_argument("--limit", type=int, default=0, help="stop after N editions (smoke test)")
    args = ap.parse_args(argv)

    source, probe = sources.resolve(args.vendor, args.prefer)
    print(f"[ingest] connector={source.kind} endpoint={source.endpoint}")

    conn = connect(args.db)
    conn.execute("DELETE FROM passages")
    conn.execute("DELETE FROM works")
    register_corpora(conn, source)

    run = conn.execute(
        "INSERT INTO ingest_runs(started_at,source_kind,source_endpoint,probe_report)"
        " VALUES (?,?,?,?)",
        (now(), source.kind, str(source.endpoint), json.dumps(probe)),
    ).lastrowid

    work_rows, passage_rows = [], []
    editions = passages = unparsed = 0

    for edition in source.iter_editions():
        parsed = tei.parse_file(edition.path, edition.namespace, edition.corpus)
        if parsed is None or not parsed[1]:
            unparsed += 1
            continue
        work, items = parsed
        editions += 1
        passages += len(items)

        work_rows.append((
            work.edition_urn, work.work_urn, work.textgroup_urn, work.corpus,
            work.author, work.title, work.edition_label, work.language,
            work.editor, work.published, work.citation_scheme,
            os.path.relpath(work.source_path, args.vendor), len(items),
        ))
        for p in items:
            passage_rows.append((p.edition_urn, p.ref, p.text,
                                 len(p.text.split()), len(p.text)))

        if len(passage_rows) >= BATCH:
            flush(conn, work_rows, passage_rows)
            print(f"[ingest] editions={editions} passages={passages}", end="\r", flush=True)

        if args.limit and editions >= args.limit:
            break

    flush(conn, work_rows, passage_rows)
    conn.execute("""
        UPDATE corpora SET
            editions = (SELECT COUNT(*) FROM works w WHERE w.corpus = corpora.key),
            passages = (SELECT COALESCE(SUM(w.passage_count), 0) FROM works w
                         WHERE w.corpus = corpora.key)
    """)
    conn.execute(
        "UPDATE ingest_runs SET finished_at=?, editions=?, passages=?, unparsed=? WHERE id=?",
        (now(), editions, passages, unparsed, run))
    conn.commit()
    conn.execute("ANALYZE")
    conn.close()

    print(f"\n[ingest] done: {editions} editions, {passages} passages, "
          f"{unparsed} skipped -> {args.db}")
    return 0


def flush(conn, work_rows, passage_rows) -> None:
    if work_rows:
        conn.executemany(
            "INSERT OR REPLACE INTO works(edition_urn,work_urn,textgroup_urn,corpus,"
            "author,title,edition_label,language,editor,published,citation_scheme,"
            "source_path,passage_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", work_rows)
        work_rows.clear()
    if passage_rows:
        conn.executemany(
            "INSERT INTO passages(edition_urn,ref,text,n_words,n_chars)"
            " VALUES (?,?,?,?,?)", passage_rows)
        passage_rows.clear()
    conn.commit()


if __name__ == "__main__":
    raise SystemExit(main())
