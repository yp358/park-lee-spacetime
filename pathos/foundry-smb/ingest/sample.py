#!/usr/bin/env python3
"""Draw the reproducible random working sample from the full warehouse.

    python3 ingest/sample.py --n 30000 --seed 20260901

Uniform simple random sample *without replacement* over the passage population.
The sample is written three ways:

* ``data/sample.db``          -- queryable SQLite for the app (with an FTS index)
* ``data/sample.jsonl.gz``    -- portable, reviewable, small enough to version
* ``data/sample_manifest.json`` -- provenance: population, n, fraction, seed,
  corpus revisions, and per-stratum counts, so the draw can be audited or redone.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import random
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import ontology  # noqa: E402

FULL_DB = os.path.join(BASE, "data", "classical_full.db")
SAMPLE_DB = os.path.join(BASE, "data", "sample.db")
JSONL = os.path.join(BASE, "data", "sample.jsonl.gz")
WORKS_JSONL = os.path.join(BASE, "data", "sample_works.jsonl.gz")
MANIFEST = os.path.join(BASE, "data", "sample_manifest.json")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def draw_ids(conn, n: int, seed: int) -> list[int]:
    """Seeded uniform sample of passage ids, without replacement."""
    ids = [row[0] for row in conn.execute("SELECT id FROM passages ORDER BY id")]
    population = len(ids)
    if n > population:
        raise SystemExit(f"requested n={n} exceeds population N={population}")
    rng = random.Random(seed)
    return population, sorted(rng.sample(ids, n))


def build(full_db: str, out_db: str, n: int, seed: int, fraction: float | None):
    src = sqlite3.connect(full_db)
    src.row_factory = sqlite3.Row

    if fraction is not None:
        n = round(src.execute("SELECT COUNT(*) FROM passages").fetchone()[0] * fraction)

    population, ids = draw_ids(src, n, seed)

    if os.path.exists(out_db):
        os.remove(out_db)
    dst = sqlite3.connect(out_db)
    dst.executescript(open(os.path.join(HERE, "schema.sql"), encoding="utf-8").read())

    # Carry provenance across unchanged.
    for table in ("corpora", "ingest_runs"):
        cols = [c[1] for c in src.execute(f"PRAGMA table_info({table})")]
        rows = [tuple(r) for r in src.execute(f"SELECT * FROM {table}")]
        if rows:
            dst.executemany(
                f"INSERT INTO {table}({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                rows)

    # Copy the sampled passages, then only the works they belong to.
    chunk = 900
    editions: set[str] = set()
    records = []
    for i in range(0, len(ids), chunk):
        window = ids[i:i + chunk]
        q = ("SELECT id,edition_urn,ref,text,n_words,n_chars FROM passages "
             f"WHERE id IN ({','.join('?' * len(window))})")
        rows = src.execute(q, window).fetchall()
        dst.executemany(
            "INSERT INTO passages(id,edition_urn,ref,text,n_words,n_chars)"
            " VALUES (?,?,?,?,?,?)", [tuple(r) for r in rows])
        for r in rows:
            editions.add(r["edition_urn"])
            records.append(dict(r))

    work_records: list[dict] = []
    work_cols = [c[1] for c in src.execute("PRAGMA table_info(works)")]
    ed = sorted(editions)
    for i in range(0, len(ed), chunk):
        window = ed[i:i + chunk]
        rows = src.execute(
            f"SELECT * FROM works WHERE edition_urn IN ({','.join('?' * len(window))})",
            window).fetchall()
        dst.executemany(
            f"INSERT INTO works({','.join(work_cols)}) "
            f"VALUES ({','.join('?' * len(work_cols))})", [tuple(r) for r in rows])
        work_records.extend(dict(r) for r in rows)

    # passage_count in the sample DB must describe the sample, not the source.
    dst.execute("UPDATE works SET passage_count = ("
                "SELECT COUNT(*) FROM passages p WHERE p.edition_urn = works.edition_urn)")
    dst.commit()

    ontology.build(dst, population=population, sample_n=len(ids), seed=seed)
    dst.commit()

    stats = {
        "generated_at": now(),
        "population_N": population,
        "sample_n": len(ids),
        "fraction": round(len(ids) / population, 6),
        "fraction_pct": round(100 * len(ids) / population, 3),
        "seed": seed,
        "method": "simple random sample without replacement (random.Random(seed).sample)",
        "works_represented": len(editions),
        "by_corpus": {r[0]: r[1] for r in dst.execute(
            "SELECT w.corpus, COUNT(*) FROM passages p JOIN works w"
            " USING(edition_urn) GROUP BY 1 ORDER BY 2 DESC")},
        "by_language": {r[0]: r[1] for r in dst.execute(
            "SELECT w.language, COUNT(*) FROM passages p JOIN works w"
            " USING(edition_urn) GROUP BY 1 ORDER BY 2 DESC")},
        "corpus_revisions": {r[0]: r[1] for r in src.execute(
            "SELECT key, revision FROM corpora")},
        "population_by_corpus": {r[0]: r[1] for r in src.execute(
            "SELECT key, passages FROM corpora")},
        "population_editions_by_corpus": {r[0]: r[1] for r in src.execute(
            "SELECT key, editions FROM corpora")},
    }
    dst.execute("ANALYZE")
    dst.commit()
    dst.close()
    src.close()
    return records, work_records, stats


def write_jsonl(records, path: str) -> None:
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--full-db", default=FULL_DB)
    ap.add_argument("--out-db", default=SAMPLE_DB)
    ap.add_argument("--n", type=int, default=30000)
    ap.add_argument("--fraction", type=float, default=None,
                    help="sample this fraction instead of a fixed n (e.g. 0.03)")
    ap.add_argument("--seed", type=int, default=20260901)
    args = ap.parse_args(argv)

    records, works, stats = build(args.full_db, args.out_db, args.n, args.seed, args.fraction)
    write_jsonl(records, JSONL)
    write_jsonl(works, WORKS_JSONL)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(stats, fh, indent=2, ensure_ascii=False)

    print(json.dumps(stats, indent=2, ensure_ascii=False))
    print(f"\n[sample] {stats['sample_n']} of {stats['population_N']} passages "
          f"({stats['fraction_pct']}%) -> {args.out_db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
