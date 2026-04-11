import hashlib
from io import BytesIO

import imagehash
from PIL import Image


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def phash_bytes(b: bytes) -> str:
    img = Image.open(BytesIO(b)).convert("RGB")
    return str(imagehash.phash(img))

