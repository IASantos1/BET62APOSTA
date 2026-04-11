from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import LOCAL_DOWNLOAD_WORKERS, MAX_IMAGES_PER_PAGE
from app.queue import download_queue
from scraper.fetcher import fetch_html
from scraper.parser import extract_images
from scraper.downloader import download_image


def scrape_page(url: str, max_images: int | None = None, use_playwright: bool = False) -> dict:
    if use_playwright:
        raise RuntimeError("playwright mode not enabled in this image")
    html = fetch_html(url)
    images = extract_images(html, url)
    limit = max_images if isinstance(max_images, int) and max_images > 0 else MAX_IMAGES_PER_PAGE
    images = images[: max(1, min(limit, 500))]
    if download_queue is None:
        workers = max(1, min(int(LOCAL_DOWNLOAD_WORKERS or 1), 32))
        results = [None] * len(images)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(download_image, images[i]): i for i in range(len(images))}
            for fut in as_completed(futs):
                idx = futs[fut]
                try:
                    results[idx] = fut.result()
                except Exception as e:
                    results[idx] = {"ok": False, "reason": "exception", "error": str(e)}
        return {"url": url, "images_found": len(images), "download_jobs": [], "download_results": results}

    jobs = []
    for img_url in images:
        job = download_queue.enqueue(download_image, img_url, job_timeout=60 * 5)
        jobs.append(job.id)
    return {"url": url, "images_found": len(images), "download_jobs": jobs}
