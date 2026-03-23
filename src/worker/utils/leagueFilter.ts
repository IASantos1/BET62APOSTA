const BLOCKED_MIDDLE_EAST_COUNTRIES = new Set([
  'saudi arabia', 'qatar', 'united arab emirates', 'uae', 'kuwait',
  'bahrain', 'oman', 'jordan', 'iraq', 'syria', 'lebanon', 'palestine',
  'palestinian territory', 'yemen', 'iran', 'israel',
]);

export const isSmallLeagueName = (name: string | undefined | null, country?: string | undefined | null) => {
  const n = String(name || '').toLowerCase();
  const c = String(country || '').toLowerCase();
  if (!n) return false;

  // Block Middle Eastern countries
  if (c && BLOCKED_MIDDLE_EAST_COUNTRIES.has(c)) return true;

  if (n.includes('sergipano')) return true;
  if (c === 'brazil' && n.includes('copinha')) return true;
  
  // Reserves / Amateur
  if (n.includes('reserve') || n.includes('reserves')) return true;
  if (n.includes('amateur')) return true;
  
  // Garbage / Fake Leagues
  if (n.includes('short football') || n.includes('short soccer')) return true;
  if (n.includes('student league')) return true;
  if (n.includes('division 4x4') || n.includes('4x4')) return true;
  if (n.includes('srl') || n.includes('simulated')) return true;
  if (n.includes('cyber') || n.includes('esports') || n.includes('e-sports')) return true;
  if (n.includes('setka cup') || n.includes('tt-cup') || n.includes('tt cup')) return true;
  if (n.includes('challenger') && !n.includes('atp') && !n.includes('wta')) return true;
  if (n.includes('itf') && (n.includes('qualifying') || n.includes('qf'))) return true;
  if (n.includes('master') && (n.includes('russia') || n.includes('belarus') || n.includes('ukraine'))) return true;
  if (n.includes('utr pro')) return true;
  if (n.includes('dream league')) return true;
  
  return false;
};
