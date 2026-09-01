"""EpiDoc/TEI parsing for the Perseus canonical corpora.

Each edition file is reduced to a flat list of *citable passages* -- the deepest
unit the CTS citation scheme addresses (a verse line, a prose section, a
chapter).  That unit is what the ontology treats as a `Passage` object.

The corpora mix three encodings: modern EpiDoc (namespaced TEI with a
``urn:cts:`` bearing edition div), older namespaced TEI whose top-level divs are
plain ``book``/``letter`` parts, and legacy ``TEI.2`` files with ``div1``/``div2``
nesting.  Tags are namespace-stripped on load so one walker handles all three.
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
XML_BASE = "{http://www.w3.org/XML/1998/namespace}base"

# Elements whose text is editorial apparatus, not the work itself.
DROP = {"note", "bibl", "biblStruct", "figure", "graphic", "teiHeader", "castList"}

# Legacy TEI.2 numbered division elements.
DIV_TAGS = {"div", "div1", "div2", "div3", "div4", "div5", "div6", "div7"}

_WS = re.compile(r"\s+")
_NS = re.compile(r"^\{[^}]*\}")


@dataclass
class Work:
    edition_urn: str
    work_urn: str
    textgroup_urn: str
    corpus: str
    author: str
    title: str
    edition_label: str
    language: str
    editor: str = ""
    published: str = ""
    source_path: str = ""
    citation_scheme: str = ""


@dataclass
class Passage:
    edition_urn: str
    ref: str
    text: str
    citation_scheme: str = ""
    extras: dict = field(default_factory=dict)


def _norm(s: str) -> str:
    return _WS.sub(" ", s).strip()


def _strip_ns(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if isinstance(el.tag, str):
            el.tag = _NS.sub("", el.tag)
    return root


def _text_of(node: ET.Element) -> str:
    out = []
    if node.text:
        out.append(node.text)
    for child in node:
        if child.tag not in DROP:
            out.append(_text_of(child))
        if child.tail:
            out.append(child.tail)
    return "".join(out)


def _first_text(root: ET.Element, path: str) -> str:
    el = root.find(path)
    return _norm(_text_of(el)) if el is not None else ""


def urn_from_filename(path: str, namespace: str) -> str:
    stem = os.path.basename(path)[: -len(".xml")]
    return f"urn:cts:{namespace}:{stem}"


def _language_of(urn: str, xml_lang: str) -> str:
    m = re.search(r"(grc|lat|eng|ger|fre|ita|spa)\d*$", urn.rsplit(".", 1)[-1] if urn else "")
    if m:
        return m.group(1)
    return (xml_lang or "und")[:3].lower()


def _edition_root(body: ET.Element):
    """Return ``(node, urn_or_empty)`` for the div that holds the work's text."""
    for div in body:
        if div.tag in DIV_TAGS and div.get("type") in ("edition", "translation"):
            n = div.get("n") or ""
            return div, n if n.startswith("urn:cts:") else ""
    return body, body.get(XML_BASE, "") if str(body.get(XML_BASE, "")).startswith("urn:cts:") else ""


def parse_file(path: str, namespace: str = "unknown", corpus: str = ""):
    """Yield ``(Work, [Passage, ...])`` for one edition file, or ``None``."""
    try:
        root = _strip_ns(ET.parse(path).getroot())
    except (ET.ParseError, UnicodeDecodeError, ValueError):
        return None

    body = root.find("text/body") or root.find(".//body")
    if body is None:
        return None

    edition, urn = _edition_root(body)
    edition_urn = urn or urn_from_filename(path, namespace)

    bits = edition_urn.split(":")
    ns = bits[2] if len(bits) > 2 else namespace
    parts = bits[-1].split(".")
    work_urn = f"urn:cts:{ns}:" + ".".join(parts[:2]) if len(parts) >= 2 else edition_urn
    textgroup_urn = f"urn:cts:{ns}:" + parts[0]

    levels = [p.get("n") for p in root.iter("cRefPattern") if p.get("n")]
    levels.reverse()  # cRefPattern is declared deepest-first

    work = Work(
        edition_urn=edition_urn,
        work_urn=work_urn,
        textgroup_urn=textgroup_urn,
        corpus=corpus or ns,
        author=_first_text(root, ".//titleStmt/author"),
        title=_first_text(root, ".//titleStmt/title"),
        edition_label=_first_text(root, ".//sourceDesc//title"),
        language=_language_of(edition_urn, edition.get(XML_LANG) or body.get(XML_LANG) or ""),
        editor=_first_text(root, ".//titleStmt/editor"),
        published=_first_text(root, ".//publicationStmt/date"),
        source_path=path,
        citation_scheme=".".join(levels),
    )

    passages: list[Passage] = []
    _walk(edition, [], passages, edition_urn, work.citation_scheme)
    return work, passages


def _textparts(node: ET.Element):
    return [d for d in node if d.tag in DIV_TAGS and d.get("n") is not None]


def _walk(node, ref, out, urn, scheme, depth=0):
    if depth > 8:
        return
    children = _textparts(node)
    if children:
        for child in children:
            _walk(child, ref + [child.get("n")], out, urn, scheme, depth + 1)
        return

    lines = [l for l in node.iter("l") if l.get("n")]
    if lines:
        for line in lines:
            text = _norm(_text_of(line))
            if text:
                out.append(Passage(urn, ".".join(ref + [line.get("n")]), text, scheme))
        return

    text = _norm(_text_of(node))
    if text and ref:
        out.append(Passage(urn, ".".join(ref), text, scheme))
