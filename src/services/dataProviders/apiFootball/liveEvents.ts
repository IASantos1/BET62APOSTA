import { apiFootballRequest } from '../../../lib/api';

// ============================================
// TIPOS DE EVENTOS POR DESPORTO
// ============================================

export type SportType = 
  | 'football' 
  | 'basketball' 
  | 'baseball' 
  | 'hockey' 
  | 'rugby' 
  | 'volleyball' 
  | 'formula1' 
  | 'mma' 
  | 'nfl' 
  | 'afl' 
  | 'handball';

// ============================================
// INTERFACE GENÉRICA DE EVENTO
// ============================================

export interface GenericLiveEvent {
  id: string;
  type: string;
  time: {
    elapsed: number;
    extra?: number;
  };
  team: {
    id: number;
    name: string;
    logo?: string;
  };
  player?: {
    id: number;
    name: string;
  };
  assist?: {
    id: number;
    name: string;
  };
  detail: string;
  comments?: string;
}

// ============================================
// FUNÇÃO PARA BUSCAR EVENTOS AO VIVO
// ============================================

export async function getLiveEventsBySport(
  sport: SportType,
  fixtureId: string
): Promise<GenericLiveEvent[]> {
  try {
    // Para futebol, usar a API-Football
    if (sport === 'football') {
      const response = await apiFootballRequest(`/fixtures?id=${fixtureId}`);
      
      if (!response?.response?.[0]?.events) {
        return [];
      }

      const events = response.response[0].events;
      
      // Mapear eventos para o formato genérico
      return events.map((event: any, index: number) => ({
        id: `${fixtureId}-${event.time.elapsed}-${index}`,
        type: event.type,
        time: {
          elapsed: event.time.elapsed,
          extra: event.time.extra
        },
        team: {
          id: event.team.id,
          name: event.team.name,
          logo: event.team.logo
        },
        player: event.player ? {
          id: event.player.id,
          name: event.player.name
        } : undefined,
        assist: event.assist ? {
          id: event.assist.id,
          name: event.assist.name
        } : undefined,
        detail: event.detail,
        comments: event.comments
      }));
    }

    // Para outros desportos, retornar array vazio por enquanto
    return [];
  } catch (error) {
    console.error(`Erro ao buscar eventos ao vivo para ${sport}:`, error);
    return [];
  }
}

export async function fetchLiveEventsForFixture(fixtureId: string | number): Promise<any[]> {
  try {
    // Limpa o ID removendo qualquer prefixo ou caractere não numérico
    const cleanId = fixtureId.toString().replace('football-', '').replace(/[^0-9]/g, '');
    
    console.log('🎯 [Live Events] ID original:', fixtureId);
    console.log('🎯 [Live Events] ID limpo:', cleanId);

    if (!cleanId || cleanId === '' || cleanId === 'undefined') {
      console.error('❌ [Live Events] ID inválido:', fixtureId);
      return [];
    }

    // ENDPOINT CORRETO PARA EVENTOS AO VIVO
    const data = await apiFootballRequest(`/fixtures/events?fixture=${cleanId}`);
    
    console.log('📦 [Live Events] Eventos recebidos:', data?.response?.length || 0);
    
    return data?.response || [];
  } catch (error) {
    console.error('🔴 [Live Events] Erro ao buscar eventos:', error);
    return [];
  }
}

// -----------------------------------------------
// Ícones e cores para cada tipo de evento
// -----------------------------------------------
export function getEventIcon(event: GenericLiveEvent): string {
  const iconMap: Record<string, string> = {
    // Football
    'Goal': '⚽',
    'Card': '🟨',
    'subst': '🔄',
    'Var': '📺',
    'Penalty': '⚠️',
    
    // Basketball
    'basket': '🏀',
    'foul': '🚫',
    'timeout': '⏸️',
    'quarter_end': '🔚',
    'free_throw': '🎯',
    
    // Baseball
    'run': '🏃',
    'strike': '⚡',
    'out': '❌',
    'home_run': '💥',
    'hit': '🎯',
    
    // Hockey
    'goal': '🏒',
    'penalty': '⚠️',
    'period_end': '🔚',
    'shot': '🎯',
    'save': '🧤',

    // Rugby
    'try': '🏉',
    'conversion': '🎯',
    'drop_goal': '⚽',
    'yellow_card': '🟨',
    'red_card': '🟥',
    
    // Volleyball
    'point': '🏐',
    'ace': '⚡',
    'block': '🚫',
    'set_end': '🔚',
    
    // Formula1
    'lap': '🏁',
    'pit_stop': '🔧',
    'overtake': '🏎️',
    'dnf': '❌',
    'fastest_lap': '⚡',
    'safety_car': '🚗',
    
    // MMA
    'round_start': '🔔',
    'round_end': '🔚',
    'takedown': '🤼',
    'submission_attempt': '🔒',
    'knockout': '💥',
    
    // NFL
    'touchdown': '🏈',
    'field_goal': '🎯',
    'interception': '🚫',
    'fumble': '💨',
    'sack': '💥',
    
    // AFL
    'behind': '1️⃣',
    'free_kick': '🦶',
    'mark': '✋',
    
    // Handball
    'exclusion': '🚫'
  };
  
  return iconMap[event.type] || '📍';
}

export function getEventColor(event: GenericLiveEvent): string {
  const colorMap: Record<string, string> = {
    'Goal': 'text-green-600',
    'goal': 'text-green-600',
    'try': 'text-green-600',
    'touchdown': 'text-green-600',
    'basket': 'text-orange-600',
    'run': 'text-blue-600',
    'Card': 'text-yellow-600',
    'red_card': 'text-red-600',
    'yellow_card': 'text-yellow-600',
    'penalty': 'text-red-600',
    'Var': 'text-purple-600',
    'knockout': 'text-red-600',
    'ace': 'text-green-600',
    'home_run': 'text-purple-600'
  };
  
  return colorMap[event.type] || 'text-gray-600';
}

export function getEventDescription(event: GenericLiveEvent): string {
  const time = event.time.extra 
    ? `${event.time.elapsed}+${event.time.extra}'`
    : `${event.time.elapsed}'`;
    
  const player = event.player ? event.player.name : '';
  const assist = event.assist ? ` (Assist: ${event.assist.name})` : '';
  
  return `${time} - ${event.team.name} - ${player} ${event.detail}${assist}`;
}

export async function fetchLiveEvents(fixtureId: string | number): Promise<any[]> {
  return fetchLiveEventsForFixture(fixtureId);
}
