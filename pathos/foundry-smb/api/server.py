#!/usr/bin/env python3
"""Read-only JSON API + static host for the SMB Foundry workspace.

    python3 api/server.py --port 8787

Stdlib only, so a small business can run it on whatever box it already has.
Everything the UI renders -- object types, their properties, the facets, the
lineage graph -- comes out of the ontology metadata in the database, so the
front end has no hard-coded knowledge of Authors, Works or Passages.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WEB_DIR = os.path.join(BASE, "web")
DB_PATH = os.path.join(BASE, "data", "sample.db")

MAX_PAGE_SIZE = 200
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class Store:
    """Thin query layer over the sample database."""

    def __init__(self, path: str):
        self.path = path
        self._ontology = None

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    # -- metadata -------------------------------------------------------
    def ontology(self) -> dict:
        if self._ontology:
            return self._ontology
        with self.connect() as conn:
            types = [dict(r) for r in conn.execute(
                "SELECT * FROM object_types ORDER BY sort_order")]
            props = [dict(r) for r in conn.execute(
                "SELECT * FROM object_properties ORDER BY object_type, sort_order")]
            links = [dict(r) for r in conn.execute("SELECT * FROM link_types")]
        by_type: dict[str, list] = {}
        for p in props:
            by_type.setdefault(p["object_type"], []).append(p)
        for t in types:
            t["properties"] = by_type.get(t["api_name"], [])
            t["links"] = [l for l in links
                          if l["source_type"] == t["api_name"]
                          or l["target_type"] == t["api_name"]]
        self._ontology = {"object_types": types, "link_types": links}
        return self._ontology

    def type_def(self, api_name: str) -> dict:
        for t in self.ontology()["object_types"]:
            if t["api_name"] == api_name:
                return t
        raise KeyError(api_name)

    # -- queries --------------------------------------------------------
    def _columns(self, t: dict) -> list[str]:
        return [p["api_name"] for p in t["properties"]]

    def search_objects(self, api_name, q="", filters=None, page=1, page_size=50,
                       sort=None, desc=False):
        t = self.type_def(api_name)
        view, cols = t["backing_table"], self._columns(t)
        if not IDENT.match(view):
            raise ValueError("bad view")

        where, params = [], []

        searchable = [p["api_name"] for p in t["properties"] if p["searchable"]]
        if q and searchable:
            if api_name == "Passage":
                # Passage search rides the FTS5 index rather than LIKE scans.
                where.append("id IN (SELECT rowid FROM passages_fts "
                             "WHERE passages_fts MATCH ?)")
                params.append(fts_query(q))
            else:
                clause = " OR ".join(f"{c} LIKE ?" for c in searchable)
                where.append(f"({clause})")
                params += [f"%{q}%"] * len(searchable)

        for key, value in (filters or {}).items():
            if key in cols and value:
                where.append(f"{key} = ?")
                params.append(value)

        sql_where = (" WHERE " + " AND ".join(where)) if where else ""
        order = ""
        if sort and sort in cols:
            order = f" ORDER BY {sort} {'DESC' if desc else 'ASC'}"

        page_size = max(1, min(int(page_size), MAX_PAGE_SIZE))
        offset = (max(1, int(page)) - 1) * page_size

        with self.connect() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM {view}{sql_where}", params).fetchone()[0]
            rows = [dict(r) for r in conn.execute(
                f"SELECT * FROM {view}{sql_where}{order} LIMIT ? OFFSET ?",
                params + [page_size, offset])]
        return {"object_type": api_name, "total": total, "page": int(page),
                "page_size": page_size, "objects": rows}

    def get_object(self, api_name, pk):
        t = self.type_def(api_name)
        view, key = t["backing_table"], t["primary_key"]
        if not (IDENT.match(view) and IDENT.match(key)):
            raise ValueError("bad identifier")
        with self.connect() as conn:
            row = conn.execute(f"SELECT * FROM {view} WHERE {key} = ?", (pk,)).fetchone()
            if row is None:
                return None
            obj = dict(row)
            links = self._linked(conn, api_name, obj)
        return {"object_type": api_name, "object": obj, "links": links}

    def _linked(self, conn, api_name, obj):
        """Resolve every link type touching this object, both directions."""
        out = []
        for link in self.ontology()["link_types"]:
            if link["source_type"] == api_name:
                other, key, col = link["target_type"], link["source_key"], link["target_key"]
                direction = "outgoing"
            elif link["target_type"] == api_name:
                other, key, col = link["source_type"], link["target_key"], link["source_key"]
                direction = "incoming"
            else:
                continue
            value = obj.get(key)
            if value is None:
                continue
            t = self.type_def(other)
            view = t["backing_table"]
            if not (IDENT.match(view) and IDENT.match(col)):
                continue
            total = conn.execute(
                f"SELECT COUNT(*) FROM {view} WHERE {col} = ?", (value,)).fetchone()[0]
            rows = [dict(r) for r in conn.execute(
                f"SELECT * FROM {view} WHERE {col} = ? LIMIT 25", (value,))]
            out.append({"link": link["api_name"], "display_name": link["display_name"],
                        "inverse_name": link["inverse_name"],
                        "direction": direction, "object_type": other,
                        "total": total, "objects": rows})
        return out

    def facets(self, api_name, prop, limit=40):
        t = self.type_def(api_name)
        view = t["backing_table"]
        if prop not in self._columns(t) or not IDENT.match(view) or not IDENT.match(prop):
            raise ValueError("unknown property")
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT {prop} AS value, COUNT(*) AS count FROM {view} "
                f"WHERE {prop} IS NOT NULL AND {prop} <> '' "
                f"GROUP BY 1 ORDER BY 2 DESC LIMIT ?", (limit,)).fetchall()
        return {"object_type": api_name, "property": prop,
                "values": [dict(r) for r in rows]}

    # -- dashboards -----------------------------------------------------
    def metrics(self):
        with self.connect() as conn:
            run = conn.execute(
                "SELECT * FROM sample_runs ORDER BY id DESC LIMIT 1").fetchone()
            ingest = conn.execute(
                "SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1").fetchone()
            by_corpus = [dict(r) for r in conn.execute(
                "SELECT corpus AS label, COUNT(*) AS value FROM obj_Passage"
                " GROUP BY 1 ORDER BY 2 DESC")]
            by_language = [dict(r) for r in conn.execute(
                "SELECT language AS label, COUNT(*) AS value FROM obj_Passage"
                " GROUP BY 1 ORDER BY 2 DESC LIMIT 10")]
            top_authors = [dict(r) for r in conn.execute(
                "SELECT name AS label, passage_count AS value, work_count FROM authors"
                " ORDER BY passage_count DESC LIMIT 12")]
            length = [dict(r) for r in conn.execute("""
                SELECT bucket AS label, COUNT(*) AS value FROM (
                    SELECT CASE
                        WHEN n_words < 10 THEN '1-9'
                        WHEN n_words < 25 THEN '10-24'
                        WHEN n_words < 50 THEN '25-49'
                        WHEN n_words < 100 THEN '50-99'
                        WHEN n_words < 250 THEN '100-249'
                        ELSE '250+' END AS bucket,
                        CASE
                        WHEN n_words < 10 THEN 0 WHEN n_words < 25 THEN 1
                        WHEN n_words < 50 THEN 2 WHEN n_words < 100 THEN 3
                        WHEN n_words < 250 THEN 4 ELSE 5 END AS ord
                    FROM passages)
                GROUP BY bucket, ord ORDER BY ord""")]
            totals = dict(conn.execute(
                "SELECT SUM(n_words) AS words, SUM(n_chars) AS chars FROM passages"
            ).fetchone())
            corpora = [dict(r) for r in conn.execute("SELECT * FROM corpora")]
        return {
            "sample": dict(run) if run else {},
            "ingest": dict(ingest) if ingest else {},
            "totals": totals,
            "counts": {t["api_name"]: t["object_count"]
                       for t in self.ontology()["object_types"]},
            "by_corpus": by_corpus,
            "by_language": by_language,
            "top_authors": top_authors,
            "passage_length": length,
            "corpora": corpora,
        }

    def lineage(self):
        with self.connect() as conn:
            nodes = [dict(r) for r in conn.execute(
                "SELECT * FROM datasets ORDER BY layer, name")]
            edges = [dict(r) for r in conn.execute("SELECT * FROM lineage_edges")]
        return {"nodes": nodes, "edges": edges}


def fts_query(q: str) -> str:
    """Turn free text into a safe FTS5 MATCH expression."""
    terms = re.findall(r"[^\s\"()*:]+", q)
    return " ".join(f'"{t}"*' for t in terms) if terms else '""'


class Handler(SimpleHTTPRequestHandler):
    store: Store = None  # injected

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()
        try:
            payload = self.route(parsed.path[len("/api/"):],
                                 urllib.parse.parse_qs(parsed.query))
        except KeyError as exc:
            return self.send_json({"error": f"unknown object type: {exc}"}, 404)
        except ValueError as exc:
            return self.send_json({"error": str(exc)}, 400)
        except sqlite3.Error as exc:
            return self.send_json({"error": f"query failed: {exc}"}, 500)
        if payload is None:
            return self.send_json({"error": "not found"}, 404)
        self.send_json(payload)

    def route(self, path: str, query: dict):
        parts = [urllib.parse.unquote(p) for p in path.split("/") if p]
        one = lambda k, d=None: query.get(k, [d])[0]

        if parts == ["health"]:
            return {"status": "ok", "database": os.path.basename(self.store.path)}
        if parts == ["ontology"]:
            return self.store.ontology()
        if parts == ["metrics"]:
            return self.store.metrics()
        if parts == ["lineage"]:
            return self.store.lineage()
        if len(parts) == 3 and parts[0] == "facets":
            return self.store.facets(parts[1], parts[2], int(one("limit", 40)))
        if len(parts) == 2 and parts[0] == "objects":
            reserved = {"q", "page", "pageSize", "sort", "desc"}
            filters = {k: v[0] for k, v in query.items() if k not in reserved}
            return self.store.search_objects(
                parts[1], q=one("q", ""), filters=filters,
                page=int(one("page", 1)), page_size=int(one("pageSize", 50)),
                sort=one("sort"), desc=one("desc") in ("1", "true"))
        if len(parts) == 3 and parts[0] == "objects":
            return self.store.get_object(parts[1], parts[2])
        return None

    def send_json(self, payload, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--db", default=DB_PATH)
    args = ap.parse_args(argv)

    if not os.path.exists(args.db):
        raise SystemExit(f"database not found: {args.db}\n"
                         "Run:  python3 ingest/restore.py   (or ingest/load.py + sample.py)")

    Handler.store = Store(args.db)
    counts = Handler.store.metrics()["counts"]
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[api] {args.db}")
    print(f"[api] objects: " + ", ".join(f"{k}={v:,}" for k, v in counts.items()))
    print(f"[api] http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[api] stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
