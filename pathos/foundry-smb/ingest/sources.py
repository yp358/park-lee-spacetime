"""Connectors to the upstream classical-text database.

The canonical home of the Greek and Latin classical corpus is the Perseus
Digital Library.  Perseus exposes it three ways, and this module wraps each so
the loader can be pointed at whichever one a deployment can actually reach:

``cts``      Scaife/Perseus CTS REST API (``GetCapabilities`` / ``GetPassage``).
             The nicest option; requires egress to ``scaife-cts.perseus.org``.
``raw``      ``raw.githubusercontent.com`` -- fetches the same TEI files the CTS
             API serves, one HTTP request per edition.
``git``      A local shallow clone of the canonical repositories.  Same bytes as
             ``raw`` but one transfer instead of thousands, so it is the default
             for a full 1.1M-passage load.

``resolve()`` probes them in preference order and returns the first that
answers, so a network-restricted host degrades instead of failing.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass

USER_AGENT = "foundry-smb-ingest/1.0 (+classical-texts ontology loader)"
TIMEOUT = 30

# The three canonical repositories that together hold the classical corpus.
CORPORA = [
    # (key, github owner/repo, CTS namespace, human label)
    ("canonical-greekLit", "PerseusDL/canonical-greekLit", "greekLit",
     "Perseus canonical Greek literature"),
    ("canonical-latinLit", "PerseusDL/canonical-latinLit", "latinLit",
     "Perseus canonical Latin literature"),
    ("First1KGreek", "OpenGreekAndLatin/First1KGreek", "greekLit",
     "Open Greek and Latin: First Thousand Years of Greek"),
]

CTS_ENDPOINT = "https://scaife-cts.perseus.org/api/cts"
RAW_HOST = "https://raw.githubusercontent.com"


@dataclass
class Edition:
    """One TEI edition, wherever it came from."""

    path: str          # local file path (git/raw cache) used by the TEI parser
    namespace: str     # CTS namespace: greekLit / latinLit
    corpus: str        # corpus key, e.g. canonical-greekLit


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def _reachable(url: str) -> bool:
    try:
        _get(url)
        return True
    except (urllib.error.URLError, OSError):
        return False


class CtsApiSource:
    """Perseus/Scaife CTS REST API."""

    kind = "cts"
    endpoint = CTS_ENDPOINT

    def available(self) -> bool:
        return _reachable(f"{self.endpoint}?request=GetCapabilities")

    def fetch_edition(self, urn: str) -> bytes:
        return _get(f"{self.endpoint}?request=GetPassage&urn={urn}")


class RawGithubSource:
    """Per-file fetch of the canonical TEI from raw.githubusercontent.com."""

    kind = "raw"
    endpoint = RAW_HOST

    def available(self) -> bool:
        return _reachable(f"{RAW_HOST}/PerseusDL/canonical-latinLit/master/README.md")

    def fetch_path(self, repo: str, ref: str, path: str) -> bytes:
        return _get(f"{RAW_HOST}/{repo}/{ref}/{path}")


class CanonicalGitSource:
    """Shallow clones of the canonical repositories, read from disk."""

    kind = "git"

    def __init__(self, vendor_dir: str):
        self.vendor_dir = vendor_dir
        self.endpoint = vendor_dir

    def available(self) -> bool:
        return all(
            os.path.isdir(os.path.join(self.vendor_dir, key, "data"))
            for key, *_ in CORPORA
        )

    def sync(self) -> None:
        """Clone anything missing.  Idempotent; safe to re-run."""
        os.makedirs(self.vendor_dir, exist_ok=True)
        for key, repo, _ns, _label in CORPORA:
            dest = os.path.join(self.vendor_dir, key)
            if os.path.isdir(os.path.join(dest, "data")):
                continue
            subprocess.run(
                ["git", "clone", "--depth", "1", f"https://github.com/{repo}.git", dest],
                check=True,
            )

    def revision(self, key: str) -> str:
        try:
            out = subprocess.run(
                ["git", "-C", os.path.join(self.vendor_dir, key), "rev-parse", "HEAD"],
                capture_output=True, text=True, check=True,
            )
            return out.stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            return ""

    def iter_editions(self):
        for key, _repo, ns, _label in CORPORA:
            root = os.path.join(self.vendor_dir, key, "data")
            if not os.path.isdir(root):
                continue
            for path in sorted(glob.glob(os.path.join(root, "**", "*.xml"), recursive=True)):
                if path.endswith("__cts__.xml"):
                    continue
                yield Edition(path=path, namespace=ns, corpus=key)


def resolve(vendor_dir: str, prefer: str | None = None):
    """Pick the best reachable connector.

    Returns ``(source, report)`` where ``report`` records what was probed, so the
    provenance of a load is auditable rather than implicit.
    """
    git = CanonicalGitSource(vendor_dir)
    candidates = [git, CtsApiSource(), RawGithubSource()]
    if prefer:
        candidates.sort(key=lambda s: s.kind != prefer)

    report = []
    for source in candidates:
        ok = source.available()
        report.append({"kind": source.kind, "endpoint": source.endpoint, "reachable": ok})
        if ok:
            return source, report

    # Nothing is up yet; git can bootstrap itself by cloning.
    git.sync()
    report.append({"kind": "git", "endpoint": vendor_dir, "reachable": git.available(),
                   "note": "cloned on demand"})
    return git, report


if __name__ == "__main__":
    vendor = os.path.join(os.path.dirname(__file__), "..", "..", "..", "vendor")
    src, rep = resolve(os.path.abspath(vendor))
    print(json.dumps({"selected": src.kind, "probed": rep}, indent=2))
