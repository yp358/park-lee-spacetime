#!/usr/bin/env python3
"""Sanity checks for the ingest → sample → serve pipeline.

    python3 ingest/test_pipeline.py

Deliberately small: these assert the properties that would quietly corrupt the
workspace if they broke -- the sample size, that the sample is a subset of the
frame, that the ontology joins resolve, and that TEI parsing still finds text.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import tei  # noqa: E402

DB = os.path.join(BASE, "data", "sample.db")
MANIFEST = os.path.join(BASE, "data", "sample_manifest.json")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def main() -> int:
    print("sample database")
    conn = sqlite3.connect(DB)
    manifest = json.load(open(MANIFEST, encoding="utf-8"))

    n = conn.execute("SELECT COUNT(*) FROM passages").fetchone()[0]
    check("sample holds the manifest's n", n == manifest["sample_n"], f"n={n:,}")
    check("n is 30,000", n == 30000)

    N = manifest["population_N"]
    check("fraction matches N", abs(n / N - manifest["fraction"]) < 1e-6,
          f"{100 * n / N:.3f}% of {N:,}")

    dupes = conn.execute(
        "SELECT COUNT(*) FROM (SELECT id FROM passages GROUP BY id HAVING COUNT(*) > 1)"
    ).fetchone()[0]
    check("sampled without replacement", dupes == 0)

    empty = conn.execute("SELECT COUNT(*) FROM passages WHERE TRIM(text) = ''").fetchone()[0]
    check("no empty passages", empty == 0)

    orphans = conn.execute(
        "SELECT COUNT(*) FROM passages p LEFT JOIN works w USING(edition_urn)"
        " WHERE w.edition_urn IS NULL").fetchone()[0]
    check("every passage resolves to a work", orphans == 0)

    print("ontology")
    for view in ("obj_Author", "obj_Work", "obj_Passage"):
        rows = conn.execute(f"SELECT COUNT(*) FROM {view}").fetchone()[0]
        check(f"{view} is populated", rows > 0, f"{rows:,} rows")

    unlinked = conn.execute(
        "SELECT COUNT(*) FROM obj_Work w LEFT JOIN authors a ON a.name = w.author"
        " WHERE a.name IS NULL").fetchone()[0]
    check("Author→Work link resolves for every work", unlinked == 0)

    counted = conn.execute(
        "SELECT COUNT(*) FROM object_types t WHERE t.object_count <> "
        "(SELECT COUNT(*) FROM obj_Passage) AND t.api_name = 'Passage'").fetchone()[0]
    check("object_count agrees with the backing view", counted == 0)

    hits = conn.execute(
        "SELECT COUNT(*) FROM passages_fts WHERE passages_fts MATCH '\"bellum\"*'"
    ).fetchone()[0]
    check("full-text index answers a query", hits > 0, f"{hits} hits for 'bellum'")

    print("TEI parser")
    fixture = os.path.join(BASE, "..", "..", "vendor", "canonical-greekLit", "data",
                           "tlg0059", "tlg001", "tlg0059.tlg001.perseus-grc1.xml")
    if os.path.exists(fixture):
        parsed = tei.parse_file(fixture, "greekLit", "canonical-greekLit")
        check("parses Plato's Euthyphro", parsed is not None and len(parsed[1]) > 0,
              f"{len(parsed[1])} passages" if parsed else "no result")
        check("captures the author", parsed and parsed[0].author == "Plato")
    else:
        print("  SKIP  TEI fixture (corpora not cloned)")

    conn.close()
    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
