import os
import random
import time
from io import BytesIO
from urllib.parse import urlparse

import certifi
import requests
from PIL import Image

from app.config import DOWNLOAD_RETRIES, HOST_MAX_CONCURRENCY, HOST_MIN_DELAY_MS, MAX_IMAGE_BYTES, REQUEST_TIMEOUT_S, TLS_CA_BUNDLE, TLS_VERIFY
from app.queue import conn
from scraper.dedupe import phash_bytes, sha256_bytes
from scraper.storage import get_storage

HASH_SET_SHA = "scraper:sha256"
HASH_SET_P = "scraper:phash"
_local_seen_sha: set[str] = set()
_local_seen_ph: set[str] = set()
_host_state: dict[str, dict[str, float | object]] = {}


def _ext_from_content_type(ct: str) -> str:
    s = (ct or "").lower()
    if "png" in s:
        return ".png"
    if "webp" in s:
        return ".webp"
    return ".jpg"


def _safe_host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "unknown").replace(":", "_")
    except Exception:
        return "unknown"


def _acquire_host(host: str):
    import threading

    h = host or "unknown"
    now = time.time()
    st = _host_state.get(h)
    if not st:
        st = {
            "lock": threading.Lock(),
            "next_at": 0.0,
            "sem": threading.Semaphore(max(1, int(HOST_MAX_CONCURRENCY or 1))),
        }
        _host_state[h] = st

    sem = st["sem"]
    lock = st["lock"]
    sem.acquire()

    try:
        with lock:
            next_at = float(st.get("next_at") or 0.0)
            wait_s = max(0.0, next_at - now)
            if wait_s > 0:
                time.sleep(wait_s)
            min_delay = max(0.0, float(int(HOST_MIN_DELAY_MS or 0)) / 1000.0)
            st["next_at"] = time.time() + min_delay
    except Exception:
        sem.release()
        raise

    return sem


def _retry_delay_s(attempt: int, retry_after: str | None) -> float:
    if retry_after:
        try:
            v = float(retry_after.strip())
            if v > 0:
                return min(60.0, v)
        except Exception:
            pass
    base = min(20.0, 0.8 * (2 ** max(0, attempt - 1)))
    return base + random.random() * 0.35



def download_image(url: str) -> dict:
    verify = (TLS_CA_BUNDLE or certifi.where()) if TLS_VERIFY else False
    host = _safe_host(url)
    sem = _acquire_host(host)
    try:
        content: bytes | None = None
        last_err: str | None = None
        retries = max(1, int(DOWNLOAD_RETRIES or 1))
        for attempt in range(1, retries + 1):
            try:
                with requests.get(
                    url,
                    headers={"Accept": "image/*", "User-Agent": "Mozilla/5.0"},
                    timeout=REQUEST_TIMEOUT_S,
                    stream=True,
                    allow_redirects=True,
                    verify=verify,
                ) as r:
                    if r.status_code in (429, 503, 502, 504):
                        last_err = f"http_{r.status_code}"
                        time.sleep(_retry_delay_s(attempt, r.headers.get("retry-after")))
                        continue

                    r.raise_for_status()

                    try:
                        content_len = int(r.headers.get("content-length") or "0")
                    except Exception:
                        content_len = 0
                    if content_len and content_len > MAX_IMAGE_BYTES:
                        return {"ok": False, "reason": "too_large", "bytes": content_len}

                    chunks: list[bytes] = []
                    total = 0
                    for chunk in r.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        chunks.append(chunk)
                        total += len(chunk)
                        if total > MAX_IMAGE_BYTES:
                            return {"ok": False, "reason": "too_large", "bytes": total}

                    content = b"".join(chunks)
                    if not content:
                        return {"ok": False, "reason": "empty"}
                    break
            except Exception as e:
                last_err = str(e)
                if attempt >= retries:
                    return {"ok": False, "reason": "fetch_failed", "error": last_err}
                time.sleep(_retry_delay_s(attempt, None))
                continue
        if content is None:
            return {"ok": False, "reason": "retry_exhausted", "error": last_err}

        sha = sha256_bytes(content)
        if conn is not None:
            if conn.sismember(HASH_SET_SHA, sha):
                return {"ok": True, "deduped": True, "sha256": sha}
        else:
            if sha in _local_seen_sha:
                return {"ok": True, "deduped": True, "sha256": sha}

        try:
            img = Image.open(BytesIO(content)).convert("RGB")
        except Exception:
            return {"ok": False, "reason": "not_image"}

        out = BytesIO()
        img.save(out, format="JPEG", quality=90, optimize=True)
        jpg = out.getvalue()

        ph = phash_bytes(jpg)
        if conn is not None:
            if conn.sismember(HASH_SET_P, ph):
                conn.sadd(HASH_SET_SHA, sha)
                return {"ok": True, "deduped": True, "sha256": sha, "phash": ph}
        else:
            if ph in _local_seen_ph:
                _local_seen_sha.add(sha)
                return {"ok": True, "deduped": True, "sha256": sha, "phash": ph}

        storage = get_storage()
        rel = os.path.join(host, f"{ph}.jpg")
        saved = storage.put_bytes(rel, jpg)

        if conn is not None:
            conn.sadd(HASH_SET_SHA, sha)
            conn.sadd(HASH_SET_P, ph)
        else:
            _local_seen_sha.add(sha)
            _local_seen_ph.add(ph)
        payload = {"ok": True, "saved": True, "path": saved.path, "sha256": sha, "phash": ph, "bytes": saved.bytes_written}
        if saved.url:
            payload["url"] = saved.url
        if saved.key:
            payload["key"] = saved.key
        return payload
    finally:
        sem.release()
