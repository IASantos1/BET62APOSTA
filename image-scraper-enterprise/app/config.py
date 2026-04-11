import os


def _env(name: str, default: str) -> str:
    v = os.getenv(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


REDIS_URL = _env("REDIS_URL", "redis://redis:6379/0")

_default_data_root = "/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data")
IMAGE_DIR = _env("IMAGE_DIR", os.path.join(_default_data_root, "images"))
JOBS_FILE = _env("JOBS_FILE", os.path.join(_default_data_root, "jobs.json"))

QUEUE_SCRAPE = _env("QUEUE_SCRAPE", "scrape")
QUEUE_DOWNLOAD = _env("QUEUE_DOWNLOAD", "download")

MAX_IMAGES_PER_PAGE = int(_env("MAX_IMAGES_PER_PAGE", "60"))
MAX_IMAGE_BYTES = int(_env("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
REQUEST_TIMEOUT_S = float(_env("REQUEST_TIMEOUT_S", "12"))
REQUEST_RETRIES = int(_env("REQUEST_RETRIES", "2"))

ALLOWED_DOMAINS = [d.strip().lower() for d in _env("ALLOWED_DOMAINS", "").split(",") if d.strip()]
DENY_DOMAINS = [d.strip().lower() for d in _env("DENY_DOMAINS", "").split(",") if d.strip()]

USER_AGENT_MODE = _env("USER_AGENT_MODE", "random")

TLS_VERIFY = _env("TLS_VERIFY", "1") not in {"0", "false", "False", "no", "NO"}
TLS_CA_BUNDLE = _env("TLS_CA_BUNDLE", "")

LOCAL_DOWNLOAD_WORKERS = int(_env("LOCAL_DOWNLOAD_WORKERS", "8"))

HOST_MAX_CONCURRENCY = int(_env("HOST_MAX_CONCURRENCY", "2"))
HOST_MIN_DELAY_MS = int(_env("HOST_MIN_DELAY_MS", "350"))
DOWNLOAD_RETRIES = int(_env("DOWNLOAD_RETRIES", "3"))

STORAGE_BACKEND = _env("STORAGE_BACKEND", "local")

S3_ENDPOINT_URL = _env("S3_ENDPOINT_URL", "")
S3_REGION = _env("S3_REGION", "auto")
S3_BUCKET = _env("S3_BUCKET", "")
S3_PREFIX = _env("S3_PREFIX", "banners")
S3_ACCESS_KEY_ID = _env("S3_ACCESS_KEY_ID", "")
S3_SECRET_ACCESS_KEY = _env("S3_SECRET_ACCESS_KEY", "")
S3_PUBLIC_BASE_URL = _env("S3_PUBLIC_BASE_URL", "")
