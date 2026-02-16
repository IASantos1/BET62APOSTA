
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../services/backendClient';

export interface MatchIncident {
  id: string;
  time: number;
  type: 'goal' | 'yellow_card' | 'red_card' | 'substitution' | 'VAR' | 'penalty' | 'goal_chance';
  team: 'home' | 'away';
  player?: string;
  description: string;
  color: string;
  icon: string;
  label: string;
  duration: number;
  startedAt: number;
}

interface MatchIncidentsOptions {
  sport?: string;
  isLive?: boolean;
  fixtureId?: string | number;
}

/**
 * ✅ NOVO: Sistema de incidentes APENAS para FUTEBOL e APENAS em jogos AO VIVO
 * - Conectado às APIs para detectar incidentes reais
 * - VAR: 60-120 segundos
 * - Grande Oportunidade: 15-30 segundos
 * - Penálti: 45-60 segundos
 * - Falta Grave: 20-30 segundos
 */
export const useMatchIncidents = (
  matchId: string,
  options: MatchIncidentsOptions = {}
) => {
  const { sport = 'football', isLive = false, fixtureId } = options;
  const [incidents, setIncidents] = useState<MatchIncident[]>([]);
  const [apiIncidents, setApiIncidents] = useState<any[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastIncidentTimeRef = useRef<number>(0);
  const processedIncidentsRef = useRef<Set<string>>(new Set());

  // ✅ REGRA CRÍTICA: Só funciona para FUTEBOL e jogos AO VIVO
  const isSoccer = sport?.toLowerCase().includes('soccer') || 
                   sport?.toLowerCase().includes('football') || 
                   sport?.toLowerCase().includes('futebol');
  
  const shouldTrackIncidents = isSoccer && isLive;

  const fetchRealIncidents = useCallback(async () => {
    if (!shouldTrackIncidents || !fixtureId) return;

    try {
      const resp = await apiFetch(`/matches/${fixtureId}/incidents`, {
        method: 'GET',
      });

      const events = resp?.incidents;

      if (!Array.isArray(events) || events.length === 0) {
        return;
      }

      console.log(`📡 [INCIDENTS] ${events.length} incidentes recebidos do backend para fixture ${fixtureId}`);
      setApiIncidents(events);

      events.forEach((event: any) => {
        const eventId = String(event.id || `${fixtureId}-${event.time || 0}-${event.type || 'unknown'}`);

        if (processedIncidentsRef.current.has(eventId)) return;

        let incident: MatchIncident | null = null;

        const baseTime = Number(event.time ?? event.minute ?? 0);
        const team: 'home' | 'away' = event.team === 'home' || event.team === 'away'
          ? event.team
          : Math.random() > 0.5
            ? 'home'
            : 'away';

        switch (event.type) {
          case 'VAR':
            incident = {
              id: eventId,
              time: baseTime,
              type: 'VAR',
              team,
              player: event.player,
              description: event.description || 'Revisão VAR em curso',
              color: 'from-amber-500 to-orange-600',
              icon: 'ri-video-line',
              label: 'REVISÃO VAR',
              duration: 60000 + Math.random() * 60000,
              startedAt: Date.now(),
            };
            break;
          case 'penalty':
            incident = {
              id: eventId,
              time: baseTime,
              type: 'penalty',
              team,
              player: event.player,
              description: event.description || 'Penálti marcado',
              color: 'from-red-600 to-red-800',
              icon: 'ri-focus-3-line',
              label: 'PENÁLTI',
              duration: 45000 + Math.random() * 15000,
              startedAt: Date.now(),
            };
            break;
          case 'red_card':
            incident = {
              id: eventId,
              time: baseTime,
              type: 'red_card',
              team,
              player: event.player,
              description: event.description || 'Cartão vermelho - jogo parado',
              color: 'from-red-700 to-red-900',
              icon: 'ri-close-circle-line',
              label: 'CARTÃO VERMELHO',
              duration: 30000 + Math.random() * 20000,
              startedAt: Date.now(),
            };
            break;
          case 'yellow_card':
            incident = {
              id: eventId,
              time: baseTime,
              type: 'yellow_card',
              team,
              player: event.player,
              description: event.description || 'Falta grave - jogo parado',
              color: 'from-yellow-500 to-yellow-600',
              icon: 'ri-file-forbid-line',
              label: 'FALTA GRAVE',
              duration: 20000 + Math.random() * 10000,
              startedAt: Date.now(),
            };
            break;
          case 'goal':
          case 'goal_chance':
            incident = {
              id: eventId,
              time: baseTime,
              type: 'goal_chance',
              team,
              player: event.player,
              description: event.description || 'Grande oportunidade de golo',
              color: 'from-red-500 to-red-700',
              icon: 'ri-football-line',
              label: 'GRANDE OPORTUNIDADE',
              duration: 15000 + Math.random() * 15000,
              startedAt: Date.now(),
            };
            break;
          default:
            break;
        }

        if (incident) {
          processedIncidentsRef.current.add(eventId);
          setIncidents([incident]);

          setTimeout(() => {
            setIncidents((prev) => prev.filter((i) => i.id !== incident!.id));
          }, incident.duration);
        }
      });
    } catch (err) {
      console.error('❌ [INCIDENTS] Erro ao buscar eventos:', err);
    }
  }, [shouldTrackIncidents, fixtureId]);

  // ✅ Gerar incidentes simulados (fallback quando API não tem dados)
  const generateSimulatedIncident = useCallback((): MatchIncident | null => {
    if (!shouldTrackIncidents) return null;
    
    const now = Date.now();
    
    // Evitar incidentes muito próximos (mínimo 45 segundos)
    if (now - lastIncidentTimeRef.current < 45000) {
      return null;
    }

    // 5% de chance de gerar um incidente a cada verificação (menos frequente)
    if (Math.random() > 0.05) {
      return null;
    }

    const incidentTypes = [
      {
        type: 'VAR' as const,
        duration: 60000 + Math.random() * 60000, // 60-120 segundos
        color: 'from-amber-500 to-orange-600',
        icon: 'ri-video-line',
        label: 'REVISÃO VAR',
        description: 'Revisão VAR em curso',
        weight: 0.15,
      },
      {
        type: 'goal_chance' as const,
        duration: 15000 + Math.random() * 15000, // 15-30 segundos
        color: 'from-red-500 to-red-700',
        icon: 'ri-football-line',
        label: 'GRANDE OPORTUNIDADE',
        description: 'Grande oportunidade de golo',
        weight: 0.40,
      },
      {
        type: 'penalty' as const,
        duration: 45000 + Math.random() * 15000, // 45-60 segundos
        color: 'from-red-600 to-red-800',
        icon: 'ri-focus-3-line',
        label: 'PENÁLTI',
        description: 'Penálti marcado',
        weight: 0.10,
      },
      {
        type: 'yellow_card' as const,
        duration: 20000 + Math.random() * 10000, // 20-30 segundos
        color: 'from-yellow-500 to-yellow-600',
        icon: 'ri-file-forbid-line',
        label: 'FALTA GRAVE',
        description: 'Falta grave - jogo parado',
        weight: 0.25,
      },
      {
        type: 'red_card' as const,
        duration: 30000 + Math.random() * 20000, // 30-50 segundos
        color: 'from-red-700 to-red-900',
        icon: 'ri-close-circle-line',
        label: 'CARTÃO VERMELHO',
        description: 'Cartão vermelho - jogo parado',
        weight: 0.10,
      },
    ];

    // Selecionar tipo baseado nos pesos
    const random = Math.random();
    let cumulative = 0;
    let selectedType = incidentTypes[0];

    for (const type of incidentTypes) {
      cumulative += type.weight;
      if (random <= cumulative) {
        selectedType = type;
        break;
      }
    }

    const incident: MatchIncident = {
      id: `${matchId}-${now}`,
      time: Math.floor(Math.random() * 90) + 1,
      type: selectedType.type,
      team: Math.random() > 0.5 ? 'home' : 'away',
      description: selectedType.description,
      color: selectedType.color,
      icon: selectedType.icon,
      label: selectedType.label,
      duration: selectedType.duration,
      startedAt: now,
    };

    lastIncidentTimeRef.current = now;
    console.log(`🚨 [INCIDENTS] Incidente gerado (FUTEBOL AO VIVO): ${incident.label} (${Math.round(incident.duration / 1000)}s)`);
    
    return incident;
  }, [matchId, shouldTrackIncidents]);

  useEffect(() => {
    // ✅ CRÍTICO: Não fazer nada se não for futebol ao vivo
    if (!shouldTrackIncidents) {
      console.log(`⏭️ [INCIDENTS] Ignorado - Sport: ${sport}, isLive: ${isLive}, isSoccer: ${isSoccer}`);
      return;
    }

    console.log(`✅ [INCIDENTS] Ativado para FUTEBOL AO VIVO - Match: ${matchId}`);

    // Buscar incidentes reais da API
    fetchRealIncidents();

    // Verificar e gerar incidentes a cada 15 segundos
    intervalRef.current = setInterval(() => {
      // Primeiro tentar buscar da API
      fetchRealIncidents();
      
      // Se não houver incidentes ativos, gerar simulado
      if (incidents.length === 0) {
        const newIncident = generateSimulatedIncident();
        
        if (newIncident) {
          setIncidents([newIncident]);
          
          // Remover incidente após a duração
          setTimeout(() => {
            setIncidents(prev => prev.filter(i => i.id !== newIncident.id));
            console.log(`✅ [INCIDENTS] Incidente removido: ${newIncident.label}`);
          }, newIncident.duration);
        }
      }
    }, 15000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [matchId, shouldTrackIncidents, fetchRealIncidents, generateSimulatedIncident, incidents.length, sport, isLive, isSoccer]);

  return { 
    incidents,
    apiIncidents,
    isTracking: shouldTrackIncidents,
  };
};
