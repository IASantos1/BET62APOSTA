# BET62 APOSTA

Plataforma completa de apostas esportivas com odds ao vivo, pagamentos integrados (Stripe + PayPal), autenticação segura e interface moderna.

## Tecnologias
- **Frontend**: React + TypeScript + Vite + Tailwind + TanStack Query
- **Backend**: Hono + Node.js
- **Database**: PostgreSQL (Supabase)
- **Auth**: Lucia
- **Real-time**: WebSockets

## Como rodar

```bash
git clone https://github.com/IASantos1/BET62APOSTA.git
cd BET62APOSTA
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

## Estrutura Recomendada
- `/src` - Frontend
- `/server` - Backend API
- `/migrations` - Database migrations
- `/docs` - Documentação
- `/tools` - Utilitários

Projeto em desenvolvimento ativo.