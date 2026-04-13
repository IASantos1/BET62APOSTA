/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔌 WebSocket para Placares em Tempo Real
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Sistema de WebSocket que elimina polling para atualizações de placares.
 * Recebe dados em tempo real via conexão persistente.
 * 
 * Funcionalidades:
 * - Conexão WebSocket persistente
 * - Reconexão automática com backoff exponencial
 * - Heartbeat para manter conexão viva
 * - Fallback para polling se WebSocket falhar
 * - Event emitter para componentes React
 */

import { Match } from '../../types/sports';
import { getLiveMatches } from '../sportsDataHub';

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS E INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface LiveScoreUpdate {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  period: string;
  statusShort: string;
  timestamp: number;
}

export interface LiveOddsUpdate {
  matchId: string;
  odds: {
    home: number;
    draw: number;
    away: number;
  };
  timestamp: number;
}

export interface LiveIncident {
  matchId: string;
  type: 'goal' | 'red_card' | 'yellow_card' | 'var' | 'penalty' | 'substitution';
  team: 'home' | 'away';
  player?: string;
  minute: number;
  detail?: string;
  timestamp: number;
}

export interface WebSocketMessage {
  type: 'score_update' | 'odds_update' | 'incident' | 'match_start' | 'match_end' | 'heartbeat' | 'initial_data';
  data: LiveScoreUpdate | LiveOddsUpdate | LiveIncident | Match | Match[] | null;
}

type EventCallback<T> = (data: T) => void;

interface EventListeners {
  score_update: Set<EventCallback<LiveScoreUpdate>>;
  odds_update: Set<EventCallback<LiveOddsUpdate>>;
  incident: Set<EventCallback<LiveIncident>>;
  match_start: Set<EventCallback<Match>>;
  match_end: Set<EventCallback<{ matchId: string }>>;
  connection_change: Set<EventCallback<{ connected: boolean }>>;
  initial_data: Set<EventCallback<Match[]>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // URLs de WebSocket (simulado localmente, pode ser substituído por servidor real)
  WS_URL: 'wss://api.example.com/live-scores', // Placeholder - usar simulação local
  
  // Reconexão
  RECONNECT_INITIAL_DELAY: 1000,
  RECONNECT_MAX_DELAY: 30000,
  RECONNECT_MULTIPLIER: 1.5,
  MAX_RECONNECT_ATTEMPTS: 10,
  
  // Heartbeat
  HEARTBEAT_INTERVAL: 25000,
  HEARTBEAT_TIMEOUT: 35000,
  
  // ✅ ATUALIZAÇÃO A CADA 15 SEGUNDOS
  USE_LOCAL_SIMULATION: true,
  SIMULATION_INTERVAL: 15000, // ✅ 15 segundos para odds e eventos ao vivo
};

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

class LiveScoresWebSocket {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectDelay = CONFIG.RECONNECT_INITIAL_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private simulationTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false; // ✅ Flag para controlar destruição
  
  // Cache de dados ao vivo
  private liveMatches: Map<string, Match> = new Map();
  private lastScores: Map<string, { home: number; away: number }> = new Map();
  
  // Event listeners
  private listeners: EventListeners = {
    score_update: new Set(),
    odds_update: new Set(),
    incident: new Set(),
    match_start: new Set(),
    match_end: new Set(),
    connection_change: new Set(),
    initial_data: new Set(),
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CONEXÃO
  // ═══════════════════════════════════════════════════════════════════════════

  connect(): void {
    if (this.isConnected) {
      console.log('🔌 [WebSocket] Já conectado');
      return;
    }

    if (CONFIG.USE_LOCAL_SIMULATION) {
      this.startLocalSimulation();
      return;
    }

    this.connectToServer();
  }

  private connectToServer(): void {
    try {
      console.log('🔌 [WebSocket] Conectando ao servidor...');
      
      this.ws = new WebSocket(CONFIG.WS_URL);
      
      this.ws.onopen = () => {
        console.log('✅ [WebSocket] Conectado!');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = CONFIG.RECONNECT_INITIAL_DELAY;
        
        this.startHeartbeat();
        this.emit('connection_change', { connected: true });
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('❌ [WebSocket] Erro:', error);
      };

      this.ws.onclose = () => {
        console.log('🔌 [WebSocket] Desconectado');
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('connection_change', { connected: false });
        this.scheduleReconnect();
      };

    } catch (error) {
      console.error('❌ [WebSocket] Erro ao conectar:', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    console.log('🔌 [WebSocket] Desconectando...');
    
    this.isDestroyed = true; // ✅ Marcar como destruído
    this.stopLocalSimulation();
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.emit('connection_change', { connected: false });
  }

  // ✅ Método para reconectar após desconexão
  reconnect(): void {
    this.isDestroyed = false;
    this.connect();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULAÇÃO LOCAL (quando não há servidor WebSocket)
  // ═══════════════════════════════════════════════════════════════════════════

  private startLocalSimulation(): void {
    // ✅ Verificar se já está destruído ou já tem timer ativo
    if (this.isDestroyed) {
      console.log('⚠️ [WebSocket] Instância destruída, não iniciando simulação');
      return;
    }
    
    // ✅ Limpar timer existente antes de criar novo
    this.stopLocalSimulation();
    
    console.log('🎮 [WebSocket] Iniciando simulação local - Atualização a cada 15 segundos');
    
    this.isConnected = true;
    this.emit('connection_change', { connected: true });

    // ✅ Simular atualizações a cada 15 segundos
    this.simulationTimer = setInterval(() => {
      if (!this.isDestroyed && this.isConnected) {
        this.simulateUpdates();
      }
    }, CONFIG.SIMULATION_INTERVAL);

    // Disparar evento de conexão
    window.dispatchEvent(new CustomEvent('websocket-connected'));
  }

  private stopLocalSimulation(): void {
    if (this.simulationTimer) {
      console.log('⏹️ [WebSocket] Parando simulação local');
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
  }

  /**
   * ✅ Simula atualizações de placares em tempo real
   * Usa os dados dos jogos ao vivo do cache
   */
  private simulateUpdates(): void {
    getLiveMatches()
      .then((matches) => {
        const next = new Map<string, Match>();
        for (const m of matches) next.set(String(m.id), m);

        const hadAny = this.liveMatches.size > 0;
        const hasAny = next.size > 0;

        if (!hadAny && hasAny) {
          this.emit('initial_data', matches);
        }

        for (const [id, m] of next.entries()) {
          const prev = this.liveMatches.get(id);

          const prevHome = Number(prev?.homeScore ?? 0);
          const prevAway = Number(prev?.awayScore ?? 0);
          const nextHome = Number(m?.homeScore ?? 0);
          const nextAway = Number(m?.awayScore ?? 0);

          const prevMin = Number(prev?.elapsed ?? 0);
          const nextMin = Number(m?.elapsed ?? 0);

          if (!prev || prevHome !== nextHome || prevAway !== nextAway || prevMin !== nextMin) {
            const minute = Number.isFinite(nextMin) ? nextMin : 0;
            this.lastScores.set(id, { home: nextHome, away: nextAway });
            this.emit('score_update', {
              matchId: id,
              homeScore: nextHome,
              awayScore: nextAway,
              minute,
              period: this.getPeriodFromMinute(minute),
              statusShort: String(m.statusShort || (m.isLive ? 'LIVE' : '')).toUpperCase(),
              timestamp: Date.now(),
            });
          }

          const prevOdds = prev?.odds;
          const nextOdds = m?.odds;
          const hasNextOdds =
            nextOdds &&
            typeof nextOdds.home === 'number' &&
            typeof nextOdds.away === 'number' &&
            nextOdds.home > 1.01 &&
            nextOdds.away > 1.01;

          if (hasNextOdds) {
            const changed =
              !prevOdds ||
              prevOdds.home !== nextOdds.home ||
              prevOdds.draw !== nextOdds.draw ||
              prevOdds.away !== nextOdds.away;

            if (changed) {
              this.emit('odds_update', {
                matchId: id,
                odds: {
                  home: Number(nextOdds.home),
                  draw: Number(nextOdds.draw || 0),
                  away: Number(nextOdds.away),
                },
                timestamp: Date.now(),
              });
            }
          }
        }

        for (const id of this.liveMatches.keys()) {
          if (!next.has(id)) {
            this.emit('match_end', { matchId: id });
          }
        }

        this.liveMatches = next;
      })
      .catch(() => {
        return;
      });
  }

  private getPeriodFromMinute(minute: number): string {
    if (minute <= 45) return 'P1';
    if (minute === 45) return 'INT';
    if (minute <= 90) return 'P2';
    return 'PRO';
  }

  private getStatusFromMinute(minute: number): string {
    if (minute <= 45) return '1H';
    if (minute === 45) return 'HT';
    if (minute <= 90) return '2H';
    return 'ET';
  }

  private randomOddsChange(currentOdd: number): number {
    return Math.max(1.01, Math.round(Number(currentOdd || 1.01) * 100) / 100);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════════════

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
        
        // Timeout se não receber resposta
        this.heartbeatTimeoutTimer = setTimeout(() => {
          console.warn('⚠️ [WebSocket] Heartbeat timeout - reconectando...');
          this.ws?.close();
        }, CONFIG.HEARTBEAT_TIMEOUT);
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECONEXÃO
  // ═══════════════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ [WebSocket] Máximo de tentativas de reconexão atingido');
      return;
    }

    this.reconnectAttempts++;
    
    console.log(`🔄 [WebSocket] Reconectando em ${this.reconnectDelay}ms (tentativa ${this.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.connectToServer();
    }, this.reconnectDelay);

    // Backoff exponencial
    this.reconnectDelay = Math.min(
      this.reconnectDelay * CONFIG.RECONNECT_MULTIPLIER,
      CONFIG.RECONNECT_MAX_DELAY
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MENSAGENS
  // ═══════════════════════════════════════════════════════════════════════════

  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      // Reset heartbeat timeout
      if (this.heartbeatTimeoutTimer) {
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null;
      }

      switch (message.type) {
        case 'score_update':
          this.emit('score_update', message.data as LiveScoreUpdate);
          break;
        case 'odds_update':
          this.emit('odds_update', message.data as LiveOddsUpdate);
          break;
        case 'incident':
          this.emit('incident', message.data as LiveIncident);
          break;
        case 'match_start':
          this.emit('match_start', message.data as Match);
          break;
        case 'match_end':
          this.emit('match_end', message.data as { matchId: string });
          break;
        case 'initial_data':
          this.emit('initial_data', message.data as Match[]);
          break;
        case 'heartbeat':
          // Heartbeat recebido - conexão OK
          break;
      }
    } catch (error) {
      console.error('❌ [WebSocket] Erro ao processar mensagem:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMITTER
  // ═══════════════════════════════════════════════════════════════════════════

  on<K extends keyof EventListeners>(
    event: K,
    callback: EventListeners[K] extends Set<infer T> ? T : never
  ): () => void {
    (this.listeners[event] as Set<typeof callback>).add(callback);
    
    // Retornar função de unsubscribe
    return () => {
      (this.listeners[event] as Set<typeof callback>).delete(callback);
    };
  }

  off<K extends keyof EventListeners>(
    event: K,
    callback: EventListeners[K] extends Set<infer T> ? T : never
  ): void {
    (this.listeners[event] as Set<typeof callback>).delete(callback);
  }

  private emit<K extends keyof EventListeners>(
    event: K,
    data: EventListeners[K] extends Set<EventCallback<infer T>> ? T : never
  ): void {
    (this.listeners[event] as Set<EventCallback<typeof data>>).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ [WebSocket] Erro no listener ${event}:`, error);
      }
    });

    // Também emitir como CustomEvent para componentes que preferem
    window.dispatchEvent(new CustomEvent(`ws-${event}`, { detail: data }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ✅ Atualizar odds reais vindas do backend
   */
  updateMatchOdds(matchId: string, odds: { home: number; draw: number; away: number }): void {
    const match = this.liveMatches.get(matchId);
    if (!match) return;

    (match as any).odds = odds;
    this.liveMatches.set(matchId, match);

    const oddsUpdate: LiveOddsUpdate = {
      matchId,
      odds,
      timestamp: Date.now(),
    };

    this.emit('odds_update', oddsUpdate);
  }

  /**
   * Registar jogos ao vivo para receber atualizações
   */
  registerMatches(matches: Match[]): void {
    matches.forEach(match => {
      const matchId = String(match.id);
      this.liveMatches.set(matchId, match);
      
      if (match.homeScore !== undefined && match.awayScore !== undefined) {
        this.lastScores.set(matchId, {
          home: match.homeScore,
          away: match.awayScore,
        });
      }

      if ((match as any).odds) {
        const o = (match as any).odds as { home: number; draw: number; away: number };
        this.updateMatchOdds(matchId, o);
      }
    });

    console.log(`📝 [WebSocket] ${matches.length} jogos registados para atualizações`);
  }

  /**
   * Recebe batch de odds do backend
   */
  updateOddsBatch(list: { matchId: string; odds: { home: number; draw: number; away: number } }[]): void {
    list.forEach((item) => {
      this.updateMatchOdds(item.matchId, item.odds);
    });
  }

  /**
   * Remover jogo do registo
   */
  unregisterMatch(matchId: string): void {
    this.liveMatches.delete(matchId);
    this.lastScores.delete(matchId);
  }

  /**
   * Obter estado da conexão
   */
  getConnectionState(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Obter jogos registados
   */
  getRegisteredMatches(): Match[] {
    return Array.from(this.liveMatches.values());
  }

  /**
   * Forçar atualização (útil para debug)
   */
  forceUpdate(): void {
    if (CONFIG.USE_LOCAL_SIMULATION) {
      this.simulateUpdates();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const liveScoresWS = new LiveScoresWebSocket();

// Auto-conectar quando o módulo é importado
if (typeof window !== 'undefined') {
  // Conectar após um pequeno delay para garantir que a app está pronta
  setTimeout(() => {
    liveScoresWS.connect();
  }, 1000);
}

export default liveScoresWS;
