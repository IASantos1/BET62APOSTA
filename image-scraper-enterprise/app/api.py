import threading

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl

from app.local_jobs import create_job, fail_job, finish_job, get_job, list_jobs, start_job
from app.queue import conn, redis_available, scrape_queue
from scraper.worker import scrape_page

app = FastAPI(title="Image Scraper Enterprise", version="0.1.0")


class ScrapeRequest(BaseModel):
    url: HttpUrl
    max_images: int | None = None
    use_playwright: bool = False


@app.get("/health")
def health():
    return {"ok": True, "redis": bool(redis_available())}


@app.post("/scrape")
def enqueue_scrape(req: ScrapeRequest):
    if redis_available() and scrape_queue is not None:
        job = scrape_queue.enqueue(
            scrape_page,
            str(req.url),
            max_images=req.max_images,
            use_playwright=req.use_playwright,
            job_timeout=60 * 10,
        )
        return {"job_id": job.id, "status": "queued", "backend": "redis"}

    j = create_job()

    def _run():
        try:
            start_job(j.id)
            r = scrape_page(str(req.url), max_images=req.max_images, use_playwright=req.use_playwright)
            finish_job(j.id, r)
        except Exception as e:
            fail_job(j.id, str(e))

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return {"job_id": j.id, "status": "queued", "backend": "local"}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    if redis_available() and conn is not None:
        from rq.job import Job

        try:
            job = Job.fetch(job_id, connection=conn)
        except Exception:
            raise HTTPException(status_code=404, detail="job not found")
        return {
            "job_id": job.id,
            "status": job.get_status(),
            "enqueued_at": job.enqueued_at.isoformat() if job.enqueued_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "ended_at": job.ended_at.isoformat() if job.ended_at else None,
            "result": job.result,
            "exc_info": job.exc_info,
            "backend": "redis",
        }

    j = get_job(job_id)
    if not j:
        raise HTTPException(status_code=404, detail="job not found")
    return {
        "job_id": j.id,
        "status": j.status,
        "enqueued_at": j.enqueued_at,
        "started_at": j.started_at,
        "ended_at": j.ended_at,
        "result": j.result,
        "exc_info": j.error,
        "backend": "local",
    }


@app.get("/jobs")
def jobs(limit: int = 30):
    if redis_available():
        raise HTTPException(status_code=400, detail="not available for redis backend")
    out = []
    for j in list_jobs(limit):
        out.append(
            {
                "job_id": j.id,
                "status": j.status,
                "enqueued_at": j.enqueued_at,
                "started_at": j.started_at,
                "ended_at": j.ended_at,
                "backend": "local",
            }
        )
    return {"jobs": out}
