import re
from typing import Iterable
from urllib.parse import urljoin

from bs4 import BeautifulSoup


def _push(out: set[str], base_url: str, raw: str | None) -> None:
    if not raw:
        return
    s = str(raw).strip()
    if not s:
        return
    if s.startswith("data:"):
        return
    out.add(urljoin(base_url, s))


def _extract_from_style(value: str, base_url: str) -> Iterable[str]:
    if not value:
        return []
    urls = re.findall(r"url\(([^)]+)\)", value, flags=re.I)
    out: list[str] = []
    for u in urls:
        uu = u.strip().strip("\"'").strip()
        if not uu or uu.startswith("data:"):
            continue
        out.append(urljoin(base_url, uu))
    return out


def extract_images(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html or "", "lxml")
    urls: set[str] = set()

    for img in soup.find_all("img"):
        for attr in ["src", "data-src", "data-lazy-src", "data-original", "data-image", "srcset", "data-srcset"]:
            val = img.get(attr)
            if not val:
                continue
            if attr.endswith("set"):
                parts = [p.strip().split(" ")[0] for p in str(val).split(",") if p.strip()]
                for p in parts:
                    _push(urls, base_url, p)
            else:
                _push(urls, base_url, val)

    for meta in soup.find_all("meta"):
        prop = str(meta.get("property") or meta.get("name") or "").lower()
        if prop in {"og:image", "og:image:url", "twitter:image", "twitter:image:src"}:
            _push(urls, base_url, meta.get("content"))

    for link in soup.find_all("link"):
        rel = " ".join(link.get("rel") or []).lower()
        if "icon" in rel or rel in {"image_src"}:
            _push(urls, base_url, link.get("href"))

    for tag in soup.find_all(style=True):
        style = str(tag.get("style") or "")
        for u in _extract_from_style(style, base_url):
            urls.add(u)

    return list(urls)

