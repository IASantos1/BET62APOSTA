#!/usr/bin/env node
/**
 * Generates .dev.vars from Replit environment variables
 * so wrangler dev can access the API keys locally.
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

const vars = {
  API_SPORTS_KEY:       process.env.API_SPORTS_KEY       || '',
  ODDS_API_KEY:         process.env.ODDS_API_KEY         || '',
  ODDS_API_BOOKMAKERS:  process.env.ODDS_API_BOOKMAKERS  || 'Bet365,1xbet,Betano,888Sport,SportingBet',
  PAYPAL_CLIENT_ID:     process.env.PAYPAL_CLIENT_ID     || '',
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
  STRIPE_SECRET_KEY:    process.env.STRIPE_SECRET_KEY    || '',
  STRIPE_PUBLIC_KEY:    process.env.STRIPE_PUBLIC_KEY    || '',
  STRIPE_WEBHOOK_SECRET:process.env.STRIPE_WEBHOOK_SECRET|| '',
  JWT_SECRET:           '7f8a9b1c-2d3e-4f5g-6h7i-8j9k0l1m2n3o-secret-key-2025',
  ADMIN_TOKEN:          'dev-admin-token',
  APP_MODE:             'REAL',
  BETTING_ENABLED:      '1',
  LICENSED:             '1',
  REAL_FEED_ENABLED:    '1',
  ENVIRONMENT:          'dev',
  NODE_ENV:             'production',
  API_SPORTS_SEASON:    '2025',
  DEV_FAKE_MATCH_DETAIL:'false',
  MEDIA_PROXY_BASE:     '',
};

const content = Object.entries(vars)
  .filter(([, v]) => v !== '')
  .map(([k, v]) => `${k}=${v}`)
  .join('\n') + '\n';

const out = resolve(ROOT, '.dev.vars');
writeFileSync(out, content, 'utf8');

const keyCount = Object.values(vars).filter((v) => v !== '').length;
console.log(`[gen-dev-vars] wrote ${keyCount} vars to .dev.vars`);

const missing = ['API_SPORTS_KEY', 'ODDS_API_KEY'].filter((k) => !vars[k]);
if (missing.length) {
  console.warn('[gen-dev-vars] WARNING: missing secrets:', missing.join(', '));
}
