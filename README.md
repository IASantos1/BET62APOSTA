# BET62 APOSTA

Plataforma completa de apostas esportivas.

## Deploy no Railway

`railway.json` já define:

- `buildCommand`: `npm run build`
- `startCommand`: `npm start`
- `NODE_ENV=production`

### Variáveis obrigatórias

- `DATABASE_URL`
- `LUCIA_SECRET_KEY`
- `TOTP_ENCRYPTION_KEY`
- `STATPAL_ACCESS_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `VITE_APP_URL`
- `KYC_STORAGE_DIR`

### Variáveis opcionais

- `ODDS_DEBUG_TOKEN`
- `PAYPAL_CLIENT_ID`

### Latência e delay da Sports API

O backend agora aceita tuning fino por ambiente para `timeout`, `cache realtime`, `odds live`, `hold` visual de eventos e reconnect do WebSocket.

Knobs principais:

- `SPORTS_PROVIDER_TIMEOUT_MS`: timeout HTTP padrão do provider
- `SPORTS_PROVIDER_LIVE_TIMEOUT_MS`: timeout para chamadas live
- `SPORTS_PREMATCH_ODDS_TTL_MS`: cache de odds prematch
- `SPORTS_LIVE_ODDS_TTL_MS`: cache fresco de odds live no REST
- `SPORTS_LIVE_HOLD_MS`: quanto tempo um evento live recente pode ser mantido para evitar flicker/sumiço
- `SPORTS_REALTIME_CACHE_TTL_MS`: cache fresco do agregado realtime
- `SPORTS_REALTIME_STALE_TTL_MS`: stale-while-revalidate do agregado realtime
- `SPORTS_WS_LIVE_ODDS_TTL_MS`: cache de odds live no WebSocket
- `SPORTS_WS_RECONNECT_MIN_MS`
- `SPORTS_WS_RECONNECT_MAX_MS`

Preset recomendado para produção com baixo delay e segurança:

```env
SPORTS_PROVIDER_TIMEOUT_MS=15000
SPORTS_PROVIDER_LIVE_TIMEOUT_MS=8000
SPORTS_PREMATCH_ODDS_TTL_MS=90000
SPORTS_LIVE_ODDS_TTL_MS=2000
SPORTS_ODDS_STALE_TTL_MS=900000
SPORTS_LIVE_HOLD_MS=30000
SPORTS_REALTIME_CACHE_TTL_MS=2000
SPORTS_REALTIME_TENNIS_CACHE_TTL_MS=1000
SPORTS_REALTIME_STALE_TTL_MS=5000
SPORTS_REALTIME_TENNIS_STALE_TTL_MS=2000
SPORTS_REALTIME_COLD_TIMEOUT_MS=8000
SPORTS_ODDS_COLD_TIMEOUT_MS=20000
SPORTS_PREGAME_COLD_TIMEOUT_MS=35000
SPORTS_WS_LIVE_ODDS_TTL_MS=2500
SPORTS_WS_ODDS_STALE_TTL_MS=900000
SPORTS_WS_SNAPSHOT_THROTTLE_MS=1000
SPORTS_WS_SNAPSHOT_CACHE_TTL_MS=2000
SPORTS_WS_SNAPSHOT_TENNIS_CACHE_TTL_MS=1000
SPORTS_WS_RECONNECT_MIN_MS=1000
SPORTS_WS_RECONNECT_MAX_MS=20000
```

Notas práticas:

- Para reduzir atraso percebido, mexa primeiro em `SPORTS_LIVE_HOLD_MS` e `SPORTS_LIVE_ODDS_TTL_MS`.
- Para falhar mais rápido quando o provider estiver lento, reduza `SPORTS_PROVIDER_LIVE_TIMEOUT_MS`.
- Não reduza agressivamente os freezes de mercado críticos sem validação operacional, porque eles protegem contra odds desatualizadas em `goal`, `var`, `penalty` e eventos equivalentes.

### Storage persistente KYC

Os documentos KYC já não ficam em `base64` no Postgres como fluxo principal. O backend grava os ficheiros num diretório local estruturado e guarda apenas metadados no banco.

No Railway, monte um volume persistente e use um caminho Linux estável, por exemplo:

```env
KYC_STORAGE_DIR=/data/kyc
```

Se `KYC_STORAGE_DIR` apontar para filesystem efémero, os documentos podem desaparecer após restart ou novo deploy.

### Stripe webhook

Configure no Stripe o endpoint:

```text
https://SEU_DOMINIO_OU_URL_RAILWAY/api/stripe/webhook
```

Eventos mínimos:

- `payment_intent.processing`
- `payment_intent.requires_action`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

### Ordem recomendada de rollout

1. Provisionar o PostgreSQL no Railway e preencher `DATABASE_URL`.
2. Criar um volume persistente e definir `KYC_STORAGE_DIR=/data/kyc`.
3. Configurar as variáveis de auth, Stripe e Sports API.
4. Fazer deploy do backend.
5. Confirmar que `/health` responde `200`.
6. Confirmar que `/api/admin/sports-provider-status` mostra `configured: true` para a Sports API.
7. Confirmar que `/api/metrics/sports` começa a expor métricas de provider.
8. Confirmar que o webhook Stripe chega com assinatura válida.
9. Testar login, refresh por cookie, upload KYC e um depósito real/de teste controlado.

### Nota de migração

O servidor em produção recusa startup se `ensureSchema` falhar. Se o ambiente Railway já existia com drift antigo, aplique também as migrations de reparo compatíveis com PostgreSQL:

- `migrations/0018_repair_railway_postgres_schema.sql`
- `migrations/0037_fix_profiles_users_fk_postgres.sql` quando o Postgres acusar `profiles_user_id_fkey cannot be implemented`
- `migrations/0038_fix_legacy_user_foreign_keys_postgres.sql` quando o Postgres acusar `bets_user_id_fkey cannot be implemented` ou outras FKs legadas com `user_id`

### Importante sobre migrations antigas

Nem todos os ficheiros em `migrations/` pertencem ao fluxo atual do Railway/PostgreSQL.

Há SQL legado de `D1/SQLite` que ainda referencia a tabela `user(id)` no singular, enquanto o schema canónico atual do Railway usa:

- `users(id)`
- `profiles.user_id REFERENCES users(id) ON DELETE CASCADE`

No Railway, use estes caminhos:

1. Preferencial: `npm run db:railway:push`
2. Reparação manual de uma base antiga com drift: `migrations/0018_repair_railway_postgres_schema.sql`

Não aplique cegamente a cadeia histórica antiga de `migrations/*.sql` num PostgreSQL do Railway.

Os ficheiros legados mais sensíveis são:

- `migrations/0002_consolidate_schema.sql`
- `migrations/0016_security_hardening.sql`
- `migrations/0017_add_kyc_state_engine.sql`
- `migrations/0019_tier1_payment_system.sql`
- `migrations/0021_allow_paypal_deposits.sql`

Resumo operacional:

- `migrations/README.md` documenta a separação entre legado D1/SQLite e Railway/Postgres
- `server/lib/db.ts` e `scripts/init-db.ts` são a source of truth do schema atual
- `server/scripts/db-push.ts` aplica o schema PostgreSQL correto via `ensureSchema()`

### Checklist rápido pós-deploy

- `GET /health` devolve `200`
- `GET /api/auth/me` com sessão válida devolve utilizador
- `POST /api/users/documents/upload?...` aceita ficheiro binário
- `GET /api/users/documents` devolve `stored: true` nos novos uploads
- `GET /api/admin/sports-provider-status` mostra métricas e sem warning de chave ausente
- `POST /api/stripe/create-payment-intent` funciona com rate limit e metadata
