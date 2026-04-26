export function getApiSportsKey(env: any): string {
  return String(
    env?.API_SPORTS_KEY ||
      env?.API_FOOTBALL_KEY ||
      env?.API_FOOTBALL_API_KEY ||
      env?.APIFOOTBALL_KEY ||
      '',
  ).trim();
}

export function getStatpalKey(env: any): string {
  return String(
    env?.STATPAL_KEY ||
      env?.STATPAL_API_KEY ||
      env?.STATPAL_ACCESS_KEY ||
      '',
  ).trim();
}

export function getOddsApiKey(env: any): string {
  return String(
    env?.ODDS_API_KEY ||
      env?.ODDS_API_IO_KEY ||
      env?.ODDS_APIIO_KEY ||
      '',
  ).trim();
}

export function getFrontendUrl(env: any): string {
  return String(
    env?.FRONTEND_URL ||
      env?.PUBLIC_FRONTEND_URL ||
      '',
  ).trim();
}

