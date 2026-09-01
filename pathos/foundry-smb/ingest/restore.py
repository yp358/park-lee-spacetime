#!/usr/bin/env python3
"""Rebuild ``data/sample.db`` from the versioned sample exports.

The 775 MB full warehouse and the 31 MB sample database are build artefacts and
are not in git; the two gzipped JSONL exports and the manifest are.  This script
turns those back into a queryable database, so a fresh clone can run the app
without re-ingesting 1.1M passages:

    python3 ingest/restore.py
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import ontology  # noqa: E402
import sources  # noqa: E402


def read_jsonl(path: str):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", default=os.path.join(BASE, "data"))
    args = ap.parse_args(argv)
    d = args.data_dir

    manifest = json.load(open(os.path.join(d, "sample_manifest.json"), encoding="utf-8"))
    out = os.path.join(d, "sample.db")
    if os.path.exists(out):
        os.remove(out)

    conn = sqlite3.connect(out)
    conn.executescript(open(os.path.join(HERE, "schema.sql"), encoding="utf-8").read())

    revisions = manifest.get("corpus_revisions", {})
    editions = manifest.get("population_editions_by_corpus", {})
    passages = manifest.get("population_by_corpus", {})
    conn.executemany(
        "INSERT INTO corpora(key,repo,namespace,label,revision,license,editions,passages)"
        " VALUES (?,?,?,?,?,?,?,?)",
        [(key, repo, ns, label, revisions.get(key, ""), "CC BY-SA 4.0",
          editions.get(key, 0), passages.get(key, 0))
         for key, repo, ns, label in sources.CORPORA])

    conn.execute(
        "INSERT INTO ingest_runs(started_at,finished_at,source_kind,source_endpoint,"
        "probe_report,editions,passages,unparsed) VALUES (?,?,?,?,?,?,?,?)",
        (manifest["generated_at"], manifest["generated_at"], "restore",
         "data/sample*.jsonl.gz", "[]", manifest["works_represented"],
         manifest["population_N"], 0))

    works = list(read_jsonl(os.path.join(d, "sample_works.jsonl.gz")))
    cols = [c[1] for c in conn.execute("PRAGMA table_info(works)")]
    conn.executemany(
        f"INSERT INTO works({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        [tuple(w.get(c) for c in cols) for w in works])

    conn.executemany(
        "INSERT INTO passages(id,edition_urn,ref,text,n_words,n_chars) VALUES (?,?,?,?,?,?)",
        [(p["id"], p["edition_urn"], p["ref"], p["text"], p["n_words"], p["n_chars"])
         for p in read_jsonl(os.path.join(d, "sample.jsonl.gz"))])

    conn.execute("UPDATE works SET passage_count = ("
                 "SELECT COUNT(*) FROM passages p WHERE p.edition_urn = works.edition_urn)")
    conn.commit()

    ontology.build(conn, population=manifest["population_N"],
                   sample_n=manifest["sample_n"], seed=manifest["seed"])
    conn.execute("ANALYZE")
    conn.commit()

    n = conn.execute("SELECT COUNT(*) FROM passages").fetchone()[0]
    conn.close()
    print(f"[restore] rebuilt {out} with {n:,} passages and {len(works):,} works")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
