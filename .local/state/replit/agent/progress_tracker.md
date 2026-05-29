[x] 1. Install the required packages
[x] 2. Restart the workflow to see if the project is working
[x] 3. Migrate Supabase to Neon Postgres
  [x] 1. Server já usa PostgreSQL nativo (pg pool) — sem Supabase
  [x] 2. Supabase Edge Functions substituídas por rotas Node.js em server/routes/
  [x] 3. API keys seguras via Replit Secrets (SPORTS_API_PRO_KEY, GITHUB_TOKEN, STRIPE, etc.)
  [x] 4. Schema criado automaticamente via ensureSchema() no arranque
  [x] 5. Código Supabase removido — projeto usa só Node.js + pg
[x] 4. Auth própria (Lucia-style) já implementada em server/routes/auth.ts + server/lib/auth.ts — sem dependência externa
[x] 5. Integrações externas via secrets seguros: SPORTS_API_PRO_KEY (dados desportivos), STRIPE_PUBLIC_KEY (pagamentos)
[x] 6. Projeto verificado end-to-end: servidor API :3000 + Vite :5000 a correr, odds reais da SportsApiPro a funcionar
[x] 7. Migração concluída — projeto operacional no Replit
