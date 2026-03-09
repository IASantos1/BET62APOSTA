// Whitelist of allowed countries and leagues
// Only events matching these criteria will be processed.

export interface AllowedLeague {
    country: string; // API-Sports Country Name
    leagues: string[]; // List of allowed league names (partial match allowed)
}

export const ALLOWED_LEAGUES: AllowedLeague[] = [
    // 🇧🇷 Brasil
    { 
        country: 'Brazil', 
        leagues: [
            'Serie A', 'Série A', 
            'Serie B', 'Série B', 
            'Copa do Brasil', 
            'Supercopa do Brasil', 
            // Estaduais (Campeonatos Estaduais)
            'Paulista', 'Carioca', 'Mineiro', 'Gaucho', 'Baiano', 'Pernambucano', 'Cearense', 'Goiano', 'Catarinense', 'Paranaense', 'Alagoano', 'Paraense', 'Potiguar'
        ] 
    },
    // 🏴 England (Inglaterra)
    { 
        country: 'England', 
        leagues: [
            'Premier League', 
            'Championship', 
            'FA Cup', 
            'EFL Cup', 'Carabao Cup', 'League Cup',
            'Community Shield'
        ] 
    },
    // 🇪🇸 Spain (Espanha)
    { 
        country: 'Spain', 
        leagues: [
            'La Liga', 'Primera Division', 
            'La Liga 2', 'Segunda Division', 
            'Copa del Rey', 
            'Supercopa de Espana', 'Supercopa'
        ] 
    },
    // 🇮🇹 Italy (Itália)
    { 
        country: 'Italy', 
        leagues: [
            'Serie A', 
            'Serie B', 
            'Coppa Italia', 
            'Supercoppa Italiana', 'Super Cup'
        ] 
    },
    // 🇫🇷 France (França)
    { 
        country: 'France', 
        leagues: [
            'Ligue 1', 
            'Ligue 2', 
            'Coupe de France', 
            'Trophee des Champions', 'Trophée des Champions'
        ] 
    },
    // 🇩🇪 Germany (Alemanha)
    { 
        country: 'Germany', 
        leagues: [
            'Bundesliga', 
            '2. Bundesliga', 
            'DFB Pokal', 'DFB-Pokal', 
            'Supercup', 'Super Cup'
        ] 
    },
    // 🇦🇷 Argentina
    { 
        country: 'Argentina', 
        leagues: [
            'Liga Profesional', 'Primera Division', 
            'Primera Nacional', 
            'Copa Argentina', 
            'Supercopa Argentina'
        ] 
    },
    // 🇵🇹 Portugal
    { 
        country: 'Portugal', 
        leagues: [
            'Primeira Liga', 'Liga Portugal', 
            'Liga Portugal 2', 
            'Taca de Portugal', 'Taça de Portugal', 
            'Taca da Liga', 'Taça da Liga', 
            'Supertaça', 'Supertaca'
        ] 
    },
    // 🇧🇪 Belgium (Bélgica)
    { 
        country: 'Belgium', 
        leagues: [
            'Pro League', 'Jupiler Pro League',
            'Challenger Pro League', 
            'Cup', 'Beker van Belgie',
            'Super Cup'
        ] 
    },
    // 🇳🇱 Netherlands (Holanda)
    { 
        country: 'Netherlands', 
        leagues: [
            'Eredivisie', 
            'Eerste Divisie', 
            'KNVB Beker', 'Cup',
            'Johan Cruijff Schaal', 'Super Cup'
        ] 
    },
    // 🏴 Scotland (Escócia)
    {
        country: 'Scotland',
        leagues: ['Premiership', 'Scottish Cup', 'League Cup']
    },
    // 🇹🇷 Turkey (Turquia)
    {
        country: 'Turkey',
        leagues: ['Super Lig', 'Süper Lig', 'Turkish Cup', 'Super Cup']
    },
    // 🇨🇭 Switzerland (Suíça)
    {
        country: 'Switzerland',
        leagues: ['Super League', 'Swiss Cup']
    },
    // 🇬🇷 Greece (Grécia)
    {
        country: 'Greece',
        leagues: ['Super League', 'Greek Cup']
    },
    // 🇩🇰 Denmark (Dinamarca)
    {
        country: 'Denmark',
        leagues: ['Superliga', 'DBU Pokalen', 'Cup']
    },
    // 🇲🇽 Mexico (México)
    {
        country: 'Mexico',
        leagues: ['Liga MX', 'Copa MX', 'Campeon de Campeones']
    },
    // 🇯🇵 Japan (Japão)
    {
        country: 'Japan',
        leagues: ['J1 League', 'J-League', 'Emperor Cup', 'J-League Cup']
    },
    // 🇺🇸 USA (Estados Unidos)
    {
        country: 'USA',
        leagues: ['Major League Soccer', 'MLS', 'US Open Cup']
    },
    // 🇺🇾 Uruguay (Uruguai)
    {
        country: 'Uruguay',
        leagues: ['Primera Division', 'Copa Uruguay']
    },
    // 🇨🇴 Colombia (Colômbia)
    {
        country: 'Colombia',
        leagues: ['Primera A', 'Primera B', 'Copa Colombia']
    },
    // 🇬🇹 Guatemala
    {
        country: 'Guatemala',
        leagues: ['Liga Nacional']
    },
    //  International (Internacional)
    {
        country: 'World',
        leagues: [
            'World Cup', 'Friendly International', 
            'Club Friendlies', 
            'Olympics',
            'Copa America', 'Euro', 'Asian Cup', 'Africa Cup of Nations',
            'UEFA Champions League', 'UEFA Europa League', 'UEFA Conference League',
            'Copa Libertadores', 'Copa Sudamericana', 'Recopa Sudamericana',
            'FIFA Club World Cup'
        ]
    }
];

// TheOddsApi Sport Keys Whitelist (Updated for Multi-Sport)
export const ALLOWED_TOA_KEYS: string[] = [
    'soccer',
    'basketball',
    'tennis',
    'hockey',
    'ice-hockey',
    'volleyball',
    'handball',
    'baseball',
    'rugby',
    'american-football',
    'mma',
    'boxing',
    'formula-1',
    'cricket',
    'afl'
];


export const isLeagueAllowed = (leagueName: string, country: string): boolean => {
    if (!leagueName || !country) return false;

    // Normalize input
    const l = leagueName.toLowerCase();
    let c = country.toLowerCase();

    // Common Country Mappings
    if (c === 'brasil') c = 'brazil';
    if (c === 'inglaterra') c = 'england';
    if (c === 'espanha') c = 'spain';
    if (c === 'itália' || c === 'italia') c = 'italy';
    if (c === 'frança' || c === 'franca') c = 'france';
    if (c === 'alemanha') c = 'germany';
    if (c === 'bélgica' || c === 'belgica') c = 'belgium';
    if (c === 'holanda') c = 'netherlands';
    if (c === 'escócia' || c === 'escocia') c = 'scotland';
    if (c === 'turquia') c = 'turkey';
    if (c === 'suíça' || c === 'suica') c = 'switzerland';
    if (c === 'grécia' || c === 'grecia') c = 'greece';
    if (c === 'dinamarca') c = 'denmark';
    if (c === 'méxico' || c === 'mexico') c = 'mexico';
    if (c === 'japão' || c === 'japao') c = 'japan';
    if (c === 'estados unidos' || c === 'usa') c = 'usa';
    if (c === 'uruguai') c = 'uruguay';
    if (c === 'colômbia' || c === 'colombia') c = 'colombia';
    if (c === 'mundo' || c === 'internacional') c = 'world';

    // Find country config
    const config = ALLOWED_LEAGUES.find(conf => conf.country.toLowerCase() === c);
    
    // If country not in whitelist, but it's "World" (International), check international leagues
    if (!config) {
        if (c === 'world') {
             const worldConfig = ALLOWED_LEAGUES.find(conf => conf.country === 'World');
             if (worldConfig) {
                 return worldConfig.leagues.some(allowed => l.includes(allowed.toLowerCase()));
             }
        }
        return false;
    }

    // Check leagues (partial match)
    return config.leagues.some(allowed => l.includes(allowed.toLowerCase()));
};

export function isSportKeyAllowed(sportKey: string): boolean {
    return ALLOWED_TOA_KEYS.includes(sportKey);
}
