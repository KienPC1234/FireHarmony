"""Shared HTTP utilities for the data-collection pipeline."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from config import REQUEST_TIMEOUT, USER_AGENT


def _request(url: str, data: bytes | None = None, headers: dict | None = None):
    h = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    return urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT)


def get_json(url: str, retries: int = 3, headers: dict | None = None) -> dict:
    for attempt in range(retries):
        try:
            with _request(url, headers=headers) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def post_json(url: str, body: dict, retries: int = 3) -> dict:
    payload = json.dumps(body).encode()
    for attempt in range(retries):
        try:
            with _request(url, data=payload,
                          headers={"Content-Type": "application/json"}) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def get_bytes(url: str, retries: int = 3) -> bytes:
    for attempt in range(retries):
        try:
            with _request(url) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")
