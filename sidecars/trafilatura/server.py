"""Trafilatura extraction sidecar for the L2 ingestion bench.

POST /extract  { "url": "..." }  or  { "html": "..." }
  -> { ok, text, title, author, date, sitename, ... }

Uses trafilatura.bare_extraction for clean text plus provenance metadata.
Fetching is done server-side (trafilatura.fetch_url) when only a url is given,
so the bench does not have to fetch raw HTML itself.
"""
from typing import Optional

import trafilatura
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class ExtractRequest(BaseModel):
    url: Optional[str] = None
    html: Optional[str] = None


@app.get("/health")
def health():
    return {"ok": True, "trafilatura": trafilatura.__version__}


@app.post("/extract")
def extract(req: ExtractRequest):
    downloaded = req.html
    if downloaded is None and req.url:
        downloaded = trafilatura.fetch_url(req.url)
    if not downloaded:
        return {"ok": False, "error": "fetch_failed", "url": req.url}

    try:
        # bare_extraction returns a dict (as_dict=True) with text + provenance.
        result = trafilatura.bare_extraction(
            downloaded,
            url=req.url,
            with_metadata=True,
            include_comments=False,
            include_tables=True,
            favor_precision=True,
            as_dict=True,
        )
    except Exception as exc:  # extraction can raise on malformed input
        return {"ok": False, "error": f"extract_exception:{exc}", "url": req.url}

    if not result or not result.get("text"):
        return {"ok": False, "error": "no_text", "url": req.url}

    return {
        "ok": True,
        "url": req.url,
        "text": result.get("text") or "",
        "title": result.get("title"),
        "author": result.get("author"),
        "date": result.get("date"),
        "sitename": result.get("sitename"),
        "description": result.get("description"),
        "categories": result.get("categories"),
        "tags": result.get("tags"),
    }
