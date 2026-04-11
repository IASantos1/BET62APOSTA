# image-scraper-enterprise

MVP de scraping de imagens com API, fila e workers distribuídos, com deduplicação e armazenamento local (pronto para adaptar para S3).

## Subir (1 comando)

```bash
cd image-scraper-enterprise
docker compose up --build
```

Se `docker` não existir no seu terminal, você precisa instalar o Docker Desktop (Windows) e reiniciar o terminal.

## VPS + Docker + R2 (recomendado)

1) No VPS, clone o projeto e entre na pasta:

```bash
cd image-scraper-enterprise
cp .env.example .env
```

2) Edite o `.env` e configure Cloudflare R2:

- `S3_ENDPOINT_URL`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `S3_BUCKET`: nome do bucket
- `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`: credenciais do R2
- `S3_PUBLIC_BASE_URL`: domínio público do bucket (R2 dev domain ou domínio custom com CDN)

3) Suba os serviços:

```bash
docker compose up -d --build
```

4) Teste:

```bash
curl http://localhost:8000/health
```

## Rodar sem Docker (somente API + fila local)

Sem Docker e sem Redis, a API funciona em modo local (executa e baixa no próprio processo).
No Windows isso também evita problemas de compatibilidade do RQ com `fork`, porque o RQ só é importado quando o Redis estiver disponível.

### 1) Instalar dependências

```powershell
cd "C:\Users\israe\Documents\trae_projects\BET62 Apostas Desportivas\image-scraper-enterprise"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2) Subir API

```powershell
uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Se sua rede/Windows der erro de certificado (MITM/proxy corporativo), rode com TLS desligado para o MVP:

```powershell
$env:TLS_VERIFY = "0"
uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Deixe esse comando rodando (não feche o terminal). Em outro terminal, teste:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health"
```

## Testar

### PowerShell (Windows)

```powershell
$body = @{ url = "https://example.com" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/scrape" -ContentType "application/json" -Body $body
```

Para páginas grandes, passe `max_images` para terminar mais rápido:

```powershell
$body = @{ url = "https://en.wikipedia.org/wiki/Portugal"; max_images = 15 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8010/scrape" -ContentType "application/json" -Body $body
```

Se você pegar 429 (Too Many Requests), reduza paralelismo no modo local:

```powershell
$env:LOCAL_DOWNLOAD_WORKERS="2"
```

Consultar status:

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/jobs/<JOB_ID>"
```

Listar últimos jobs (modo local):

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8010/jobs"
```

### Bash (Linux/macOS/Git Bash)

```bash
curl -X POST "http://localhost:8000/scrape" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Consultar status:

```bash
curl http://localhost:8000/jobs/<JOB_ID>
```

## Escalar workers

```bash
docker compose up --scale worker=5
```

Se você tiver o binário antigo `docker-compose`, também funciona:

```bash
docker-compose up --build
```

## Onde salva

Imagens em:

```
image-scraper-enterprise/data/images/
```

Jobs (modo local) em:

```
image-scraper-enterprise/data/jobs.json
```

## Variáveis de ambiente

- `REDIS_URL` (default `redis://redis:6379/0`)
- `IMAGE_DIR` (default `/data/images`)
- `JOBS_FILE` (default `/data/jobs.json`)
- `MAX_IMAGES_PER_PAGE` (default `60`)
- `MAX_IMAGE_BYTES` (default `8388608`)
- `ALLOWED_DOMAINS` (default vazio, permite qualquer domínio exceto `DENY_DOMAINS`)
- `DENY_DOMAINS` (default vazio)
- `TLS_VERIFY` (default `1`; em redes com proxy corporativo pode precisar `0`)
- `TLS_CA_BUNDLE` (default vazio; se precisar, aponte para um `.pem` com a CA)
- `LOCAL_DOWNLOAD_WORKERS` (default `8`)
- `HOST_MAX_CONCURRENCY` (default `2`)
- `HOST_MIN_DELAY_MS` (default `350`)
- `DOWNLOAD_RETRIES` (default `3`)
- `STORAGE_BACKEND` (default `local`; use `r2` para Cloudflare R2)
- `S3_ENDPOINT_URL`
- `S3_REGION` (default `auto` para R2)
- `S3_BUCKET`
- `S3_PREFIX` (default `banners`)
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_PUBLIC_BASE_URL`
