export const isSmallLeagueName = (name: string | undefined | null, country?: string | undefined | null) => {
  const n = String(name || '').toLowerCase();
  const c = String(country || '').toLowerCase();
  if (!n) return false;

  // STRICT BLOCK: U-levels, Youth, Reserves, Women
  if (
    n.includes('youth') ||
    n.includes('u20') ||
    n.includes('u-20') ||
    n.includes('sub-20') ||
    n.includes('sub20') ||
    n.includes('u21') ||
    n.includes('u-21') ||
    n.includes('u19') ||
    n.includes('u-19') ||
    n.includes('u17') ||
    n.includes('u-17') ||
    n.includes('u18') ||
    n.includes('u-18') ||
    n.includes('u23') ||
    n.includes('u-23') ||
    n.includes('u22') ||
    n.includes('u-22') ||
    n.includes('u25') ||
    n.includes('u-25')
  ) {
    return true;
  }

  if (
    n.includes('women') ||
    n.includes('feminino') ||
    n.includes('feminina') ||
    n.includes('femininas') ||
    n.includes('feminine') ||
    n.includes('ladies') ||
    n.includes('mulheres') ||
    n.includes('womens') ||
    n.includes('w-league')
  ) {
    return true;
  }

  if (n.includes('youth cup')) return true;
  if (n.includes('sergipano')) return true;
  if (c === 'brazil' && n.includes('copinha')) return true;
  
  // Specific small/unwanted leagues
  if (n.includes('reserve') || n.includes('reserves')) return true;
  if (n.includes('amateur')) return true;
  if (n.includes('regional')) return true;
  if (n.includes('state league')) return true; // generic state leagues often low tier
  
  // Expanded Blacklist (User Request: "muitos jogos de ligas pequenas")
  if (n.includes('division 2') || n.includes('2. division') || n.includes('2nd division')) return true;
  if (n.includes('division 3') || n.includes('3. division') || n.includes('3rd division')) return true;
  if (n.includes('division 4') || n.includes('4. division') || n.includes('4th division')) return true;
  if (n.includes('serie c') || n.includes('serie d')) return true;
  if (n.includes('oberliga') || n.includes('regionalliga') || n.includes('landesliga')) return true;
  if (n.includes('non-league') || n.includes('isthmian') || n.includes('southern league')) return true;
  if (n.includes('npl') && (c === 'australia' || n.includes('australia'))) return true; // Australian State Leagues
  
  // Garbage / Fake Leagues (User Request: "Ligas Lixo / Esports")
  if (n.includes('short football') || n.includes('short soccer')) return true;
  if (n.includes('student league')) return true;
  if (n.includes('division 4x4') || n.includes('4x4')) return true;
  if (n.includes('srl') || n.includes('simulated')) return true;
  if (n.includes('cyber') || n.includes('esports') || n.includes('e-sports')) return true;
  if (n.includes('setka cup') || n.includes('tt-cup') || n.includes('tt cup')) return true; // Table Tennis minor
  if (n.includes('challenger') && !n.includes('atp') && !n.includes('wta')) return true; // Low tier tennis (unless specified)
  if (n.includes('itf') && (n.includes('qualifying') || n.includes('qf'))) return true;
  if (n.includes('master') && (n.includes('russia') || n.includes('belarus') || n.includes('ukraine'))) return true; // "Masters" fake leagues
  if (n.includes('utr pro')) return true;
  if (n.includes('dream league')) return true;
  if (n.includes('sub-') || n.includes('sub ')) return true; // Generic youth
  
  return false;
};
