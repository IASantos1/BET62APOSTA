# BET62 APOSTA

**Plataforma completa de apostas esportivas em tempo real.**

## Tecnologias Principais
- **Frontend**: React  + TypeScript + Vite + Tailwind
- **Backend**: Hono + Node.js
- **Banco**: PostgreSQL (Supabase)
- **Auth**: Lucia
- **Pagamentos**: Stripe + PayPal
- **Real-time**: WebSocket

## Como Executar

```bash
# 1. Clone
git clone https://github.com/IASantos1/BET62APOSTA.git
cd BET62APOSTA

# 2. Instale
npm install

# 3. Configure
cp .env.example .env

# 4. Migrações
npm run db:migrate

# 5. Rode
npm run dev
```

## Estrutura
- `/src` - Frontend
- `/server` - Backend API
- `/migrations` - Banco
- `/supabase` - Edge Functions
- `/docs` - Documentação
- `/tools` - Utilitários

**Projeto em desenvolvimento ativo.**