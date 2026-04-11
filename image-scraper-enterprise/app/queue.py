import redis

from app.config import QUEUE_DOWNLOAD, QUEUE_SCRAPE, REDIS_URL

conn = None
scrape_queue = None
download_queue = None

try:
    from rq import Queue

    _c = redis.from_url(REDIS_URL)
    _c.ping()
    conn = _c
    scrape_queue = Queue(QUEUE_SCRAPE, connection=conn, default_timeout=60 * 10)
    download_queue = Queue(QUEUE_DOWNLOAD, connection=conn, default_timeout=60 * 10)
except Exception:
    conn = None
    scrape_queue = None
    download_queue = None


def redis_available() -> bool:
    return conn is not None and scrape_queue is not None and download_queue is not None
