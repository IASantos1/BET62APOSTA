import os
from dataclasses import dataclass

from app.config import (
    IMAGE_DIR,
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT_URL,
    S3_PREFIX,
    S3_PUBLIC_BASE_URL,
    S3_REGION,
    S3_SECRET_ACCESS_KEY,
    STORAGE_BACKEND,
)


@dataclass(frozen=True)
class SavedObject:
    path: str
    bytes_written: int
    key: str | None = None
    url: str | None = None


class LocalStorage:
    def __init__(self, base_dir: str = IMAGE_DIR):
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)

    def put_bytes(self, rel_path: str, data: bytes) -> SavedObject:
        safe_rel = rel_path.lstrip("/").replace("..", "_")
        abs_path = os.path.join(self.base_dir, safe_rel)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "wb") as f:
            f.write(data)
        return SavedObject(path=abs_path, bytes_written=len(data), key=safe_rel, url=None)


class S3Storage:
    def __init__(
        self,
        *,
        endpoint_url: str,
        region: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        public_base_url: str,
        prefix: str,
    ):
        import boto3

        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/")
        self.prefix = prefix.strip("/").strip()
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            region_name=region or None,
            aws_access_key_id=access_key_id or None,
            aws_secret_access_key=secret_access_key or None,
        )

    def _make_key(self, rel_path: str) -> str:
        safe_rel = rel_path.lstrip("/").replace("..", "_")
        if self.prefix:
            return f"{self.prefix}/{safe_rel}"
        return safe_rel

    def _public_url(self, key: str) -> str | None:
        if not self.public_base_url:
            return None
        return f"{self.public_base_url}/{key}"

    def put_bytes(self, rel_path: str, data: bytes) -> SavedObject:
        key = self._make_key(rel_path)
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType="image/jpeg",
            CacheControl="public, max-age=31536000, immutable",
        )
        return SavedObject(path=key, bytes_written=len(data), key=key, url=self._public_url(key))


_storage_singleton = None


def get_storage():
    global _storage_singleton
    if _storage_singleton is not None:
        return _storage_singleton
    backend = (STORAGE_BACKEND or "local").strip().lower()
    if backend in {"s3", "r2"}:
        if not S3_BUCKET or not S3_PUBLIC_BASE_URL:
            raise RuntimeError("S3_BUCKET e S3_PUBLIC_BASE_URL são obrigatórios quando STORAGE_BACKEND=s3")
        if not S3_ACCESS_KEY_ID or not S3_SECRET_ACCESS_KEY:
            raise RuntimeError("S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY são obrigatórios quando STORAGE_BACKEND=s3")
        if not S3_ENDPOINT_URL:
            raise RuntimeError("S3_ENDPOINT_URL é obrigatório para Cloudflare R2")
        _storage_singleton = S3Storage(
            endpoint_url=S3_ENDPOINT_URL,
            region=S3_REGION,
            bucket=S3_BUCKET,
            access_key_id=S3_ACCESS_KEY_ID,
            secret_access_key=S3_SECRET_ACCESS_KEY,
            public_base_url=S3_PUBLIC_BASE_URL,
            prefix=S3_PREFIX,
        )
        return _storage_singleton
    _storage_singleton = LocalStorage()
    return _storage_singleton
