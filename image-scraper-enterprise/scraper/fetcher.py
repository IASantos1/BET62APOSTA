import re
from urllib.parse import urlparse

import certifi
import requests
from fake_useragent import UserAgent

from app.config import ALLOWED_DOMAINS, DENY_DOMAINS, REQUEST_RETRIES, REQUEST_TIMEOUT_S, TLS_CA_BUNDLE, TLS_VERIFY, USER_AGENT_MODE

_ua = UserAgent()


def _host(url: str) -> str:
    try:
        return urlparse(url).hostname or ""
    except Exception:
        return ""


def _allowed(url: str) -> bool:
    host = _host(url).lower()
    if not host:
        return False
    if DENY_DOMAINS and any(host == d or host.endswith(f".{d}") for d in DENY_DOMAINS):
        return False
    if ALLOWED_DOMAINS and not any(host == d or host.endswith(f".{d}") for d in ALLOWED_DOMAINS):
        return False
    return True


def _user_agent() -> str:
    if USER_AGENT_MODE == "fixed":
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    return _ua.random


def fetch_html(url: str) -> str:
    if not _allowed(url):
        raise ValueError("domain not allowed")

    s = requests.Session()
    last_exc: Exception | None = None
    verify = (TLS_CA_BUNDLE or certifi.where()) if TLS_VERIFY else False
    for _ in range(max(1, REQUEST_RETRIES + 1)):
        try:
            r = s.get(
                url,
                headers={
                    "User-Agent": _user_agent(),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
                },
                timeout=REQUEST_TIMEOUT_S,
                allow_redirects=True,
                verify=verify,
            )
            r.raise_for_status()
            text = r.text or ""
            if not re.search(r"<html|<img|og:image|twitter:image", text, flags=re.I):
                return text
            return text
        except Exception as e:
            last_exc = e
    raise last_exc or RuntimeError("fetch failed")
