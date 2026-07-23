Cria um ficheiro `env/.env` (não é versionado) e coloca a tua configuração canónica:

STATPAL_API_KEY=COLOCA_AQUI
STATPAL_BASE_URL=https://statpal.io/api
FOOTBALL_LIVE_PROVIDER=statpal
FOOTBALL_DAILY_PROVIDER=statpal
FOOTBALL_REFERENCE_PROVIDER=statpal
STATPAL_ONLY=true

Aliases legados ainda aceitos temporariamente, mas não recomendados:

# STATPAL_ACCESS_KEY=COLOCA_AQUI
# STATPAL_KEY=COLOCA_AQUI

Opcional (para usar o endpoint de debug):

ODDS_DEBUG_TOKEN=qualquer_token

Depois inicia o backend normalmente.
