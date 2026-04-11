import json
import os
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import JOBS_FILE


@dataclass
class LocalJob:
    id: str
    status: str
    enqueued_at: str
    started_at: str | None = None
    ended_at: str | None = None
    result: dict | None = None
    error: str | None = None


_lock = threading.Lock()
_jobs: dict[str, LocalJob] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dict(j: LocalJob) -> dict:
    return {
        "id": j.id,
        "status": j.status,
        "enqueued_at": j.enqueued_at,
        "started_at": j.started_at,
        "ended_at": j.ended_at,
        "result": j.result,
        "error": j.error,
    }


def _from_dict(d: dict) -> LocalJob:
    return LocalJob(
        id=str(d.get("id") or ""),
        status=str(d.get("status") or "queued"),
        enqueued_at=str(d.get("enqueued_at") or _now()),
        started_at=d.get("started_at"),
        ended_at=d.get("ended_at"),
        result=d.get("result"),
        error=d.get("error"),
    )


def _load_jobs() -> None:
    p = str(JOBS_FILE or "").strip()
    if not p:
        return
    try:
        if not os.path.exists(p):
            return
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return
        items = data.get("jobs")
        if not isinstance(items, list):
            return
        for it in items:
            if not isinstance(it, dict):
                continue
            j = _from_dict(it)
            if j.id:
                _jobs[j.id] = j
    except Exception:
        return


def _persist_jobs() -> None:
    p = str(JOBS_FILE or "").strip()
    if not p:
        return
    try:
        os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
        tmp = f"{p}.tmp"
        payload = {"jobs": [_to_dict(j) for j in _jobs.values()]}
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, p)
    except Exception:
        return


with _lock:
    _load_jobs()


def create_job() -> LocalJob:
    j = LocalJob(id=str(uuid.uuid4()), status="queued", enqueued_at=_now())
    with _lock:
        _jobs[j.id] = j
        _persist_jobs()
    return j


def start_job(job_id: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return
        j.status = "started"
        j.started_at = _now()
        _persist_jobs()


def finish_job(job_id: str, result: dict) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return
        j.status = "finished"
        j.ended_at = _now()
        j.result = result
        _persist_jobs()


def fail_job(job_id: str, error: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return
        j.status = "failed"
        j.ended_at = _now()
        j.error = error
        _persist_jobs()


def get_job(job_id: str) -> LocalJob | None:
    with _lock:
        return _jobs.get(job_id)


def list_jobs(limit: int = 30) -> list[LocalJob]:
    with _lock:
        values = list(_jobs.values())
    values.sort(key=lambda j: j.enqueued_at, reverse=True)
    return values[: max(1, min(int(limit or 30), 200))]
