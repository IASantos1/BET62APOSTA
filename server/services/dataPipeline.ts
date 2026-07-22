export type FeedSourceStatus = {
  key: string;
  label: string;
  enabled: boolean;
  role: 'primary' | 'secondary' | 'manual';
};

export type PipelineStageStatus = {
  key: string;
  label: string;
  status: 'active' | 'partial' | 'manual';
  details: string;
};

export type FeedValidationReport = {
  totalEvents: number;
  uniqueEvents: number;
  duplicateEvents: number;
  liveEvents: number;
  liveWithoutScore: number;
  inconsistentStates: number;
  invalidClock: number;
  feedQualityScore: number;
};

export type SportsDataPipelineStatus = {
  provider: string;
  providerConfigured: boolean;
  feeds: FeedSourceStatus[];
  stages: PipelineStageStatus[];
  validation: FeedValidationReport;
  supportedSports: string[];
  supportedSettlements: string[];
  matchState: {
    score: number;
    clock: number;
    incidents: number;
    suspended: number;
  };
};

export type BetSelectionLike = {
  event_id?: string | number;
  selection?: string;
  odd?: number;
  market?: string;
  market_key?: string;
};

function toNumber(value: any): number {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isLiveLike(event: any): boolean {
  const status = String(event?.status || '').toUpperCase().trim();
  return (
    Number(event?.is_live) === 1 ||
    status === 'LIVE' ||
    ['1H', '2H', 'HT', 'ET', 'ET1', 'ET2', 'P', 'PEN', 'SO', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'P1', 'P2', 'P3', 'IN', 'IN_PROGRESS'].includes(status)
  );
}

function isFinishedLike(event: any): boolean {
  const status = String(event?.status || '').toUpperCase().trim();
  return (
    status === 'FT' ||
    status === 'AET' ||
    status === 'FT_PEN' ||
    status === 'FTPEN' ||
    status === 'FINAL' ||
    status === 'ENDED' ||
    status === 'FINISHED'
  );
}

function hasVisibleScore(event: any): boolean {
  const home = event?.home_score ?? event?.score?.home ?? event?.scores?.home;
  const away = event?.away_score ?? event?.score?.away ?? event?.scores?.away;
  return Number.isFinite(Number(home)) && Number.isFinite(Number(away));
}

function hasClock(event: any): boolean {
  const elapsed = toNumber(event?.elapsed ?? event?.time ?? event?.timer);
  return elapsed > 0;
}

function isSuspendedLike(event: any): boolean {
  const status = String(event?.status || '').toUpperCase().trim();
  return ['SUSP', 'SUSPENDED', 'INT', 'DELAYED'].includes(status);
}

function collectEvents(input: unknown): any[] {
  if (Array.isArray(input)) return input.filter(Boolean);
  if (input instanceof Map) {
    return Array.from(input.values())
      .map((entry: any) => entry?.data ?? entry?.event ?? entry)
      .filter(Boolean);
  }
  return [];
}

export function buildFeedValidationReport(source: unknown): FeedValidationReport {
  const events = collectEvents(source);
  const seen = new Set<string>();
  let duplicateEvents = 0;
  let liveEvents = 0;
  let liveWithoutScore = 0;
  let inconsistentStates = 0;
  let invalidClock = 0;

  for (const event of events) {
    const id = String(event?.id || event?.external_event_id || '').trim();
    if (id) {
      if (seen.has(id)) duplicateEvents += 1;
      seen.add(id);
    }

    const live = isLiveLike(event);
    const finished = isFinishedLike(event);
    if (live) liveEvents += 1;
    if (live && !hasVisibleScore(event)) liveWithoutScore += 1;
    if (live && finished) inconsistentStates += 1;
    if (live && !hasClock(event)) invalidClock += 1;
  }

  const totalEvents = events.length;
  const penalties =
    duplicateEvents * 8 +
    liveWithoutScore * 6 +
    inconsistentStates * 12 +
    invalidClock * 4;
  const denominator = Math.max(1, totalEvents * 10);
  const feedQualityScore = Math.max(0, Math.min(100, Math.round(100 - (penalties / denominator) * 100)));

  return {
    totalEvents,
    uniqueEvents: seen.size,
    duplicateEvents,
    liveEvents,
    liveWithoutScore,
    inconsistentStates,
    invalidClock,
    feedQualityScore,
  };
}

export function buildSportsDataPipelineStatus(input: {
  apiKey?: string;
  eventsCache?: unknown;
  adminOddsEvents?: unknown;
  provider?: string;
}): SportsDataPipelineStatus {
  const cacheEvents = collectEvents(input.eventsCache);
  const adminOddsEvents = collectEvents(input.adminOddsEvents);
  const allEvents = [...cacheEvents, ...adminOddsEvents];
  const validation = buildFeedValidationReport(allEvents);
  const provider = String(input.provider || 'statpal').trim().toLowerCase() || 'statpal';
  const providerLabel = 'StatPal';

  const feeds: FeedSourceStatus[] = [
    { key: 'sportradar', label: 'Sportradar', enabled: false, role: 'secondary' },
    { key: 'stats-perform', label: 'Stats Perform', enabled: false, role: 'secondary' },
    { key: 'statpal', label: 'StatPal', enabled: Boolean(String(input.apiKey || '').trim()), role: 'primary' },
    { key: 'internal-scout', label: 'Feed proprio / Scout', enabled: false, role: 'manual' },
  ];

  const matchStateScore = allEvents.filter(hasVisibleScore).length;
  const matchStateClock = allEvents.filter(hasClock).length;
  const matchStateSuspended = allEvents.filter(isSuspendedLike).length;

  const stages: PipelineStageStatus[] = [
    {
      key: 'ingestion',
      label: 'Feed Ingestion Service',
      status: feeds.some((f) => f.role === 'primary' && f.enabled) ? 'active' : 'partial',
      details: `${providerLabel} alimenta live, schedule, odds, stats, incidents e standings.`,
    },
    {
      key: 'normalization',
      label: 'Normalizacao dos Dados',
      status: 'active',
      details: 'Payloads do provider sao convertidos para eventos normalizados usados por HTTP, WS e settlement.',
    },
    {
      key: 'validation',
      label: 'Data Validation Engine',
      status: validation.feedQualityScore >= 80 ? 'active' : 'partial',
      details: `Integridade=${validation.totalEvents}, duplicados=${validation.duplicateEvents}, score de qualidade=${validation.feedQualityScore}.`,
    },
    {
      key: 'match-state',
      label: 'Match State Engine',
      status: 'active',
      details: `Placar em ${matchStateScore} eventos, relogio em ${matchStateClock}, suspensoes em ${matchStateSuspended}.`,
    },
    {
      key: 'market-resolution',
      label: 'Market Resolution Engine',
      status: 'active',
      details: 'Mercados sao resolvidos no backend com regras por esporte e mercado no settlement atual.',
    },
    {
      key: 'settlement',
      label: 'Settlement Engine',
      status: 'active',
      details: 'Fluxo automatico + revisao manual via admin para settle por evento, resultado manual e dry-run.',
    },
    {
      key: 'manual-review',
      label: 'Manual Review Queue',
      status: 'manual',
      details: 'Eventos inconsistentes podem seguir para revisao operacional no painel admin.',
    },
  ];

  return {
    provider: provider.toUpperCase(),
    providerConfigured: Boolean(String(input.apiKey || '').trim()),
    feeds,
    stages,
    validation,
    supportedSports: ['Futebol', 'Basquete', 'Tenis', 'Volei', 'Hoquei', 'MMA', 'Outros'],
    supportedSettlements: [
      '1X2',
      'Over/Under',
      'Handicap',
      'Asian Handicap',
      'BTTS',
      'Escanteios',
      'Cartoes',
      'Jogador',
      'Sets',
      'Games',
      'Pontos',
      'Props',
      'Especiais',
    ],
    matchState: {
      score: matchStateScore,
      clock: matchStateClock,
      incidents: validation.liveEvents,
      suspended: matchStateSuspended,
    },
  };
}

export function validateBetSelections(selections: BetSelectionLike[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(selections) ? selections : [];

  if (list.length === 0) return ['Nenhuma selecao informada'];
  if (list.length > 25) errors.push('Numero maximo de selecoes excedido');

  for (const item of list) {
    const eventId = String(item?.event_id || '').trim();
    const selection = String(item?.selection || '').trim();
    const market = String(item?.market || item?.market_key || '').trim();
    const odd = toNumber(item?.odd);
    const signature = `${eventId}::${market}::${selection}`.toLowerCase();

    if (!eventId) errors.push('Selecao sem event_id');
    if (!selection) errors.push('Selecao sem nome');
    if (odd <= 1) errors.push(`Odd invalida para o evento ${eventId || '?'}`);
    if (seen.has(signature)) errors.push(`Selecao duplicada no evento ${eventId || '?'}`);
    seen.add(signature);
  }

  return Array.from(new Set(errors));
}
