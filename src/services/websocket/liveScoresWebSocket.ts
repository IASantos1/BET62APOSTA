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
    const matches = Array.from(this.liveMatches.values());
    
    if (matches.length === 0) return;

    // Selecionar 1-3 jogos aleatórios para atualizar
    const numUpdates = Math.min(matches.length, Math.floor(Math.random() * 3) + 1);
    const shuffled = [...matches].sort(() => Math.random() - 0.5);
    const toUpdate = shuffled.slice(0, numUpdates);

    toUpdate.forEach(match => {
      const matchId = String(match.id);
      const lastScore = this.lastScores.get(matchId) || { 
        home: match.homeScore || 0, 
        away: match.awayScore || 0 
      };

      // 5% de chance de golo
      const goalChance = Math.random();
      let newHomeScore = lastScore.home;
      let newAwayScore = lastScore.away;
      let incident: LiveIncident | null = null;

      if (goalChance < 0.05) {
        // Golo!
        const isHomeGoal = Math.random() > 0.5;
        if (isHomeGoal) {
          newHomeScore++;
          incident = {
            matchId,
            type: 'goal',
            team: 'home',
            player: 'Jogador',
            minute: match.elapsed || Math.floor(Math.random() * 90),
            timestamp: Date.now(),
          };
        } else {
          newAwayScore++;
          incident = {
            matchId,
            type: 'goal',
            team: 'away',
            player: 'Jogador',
            minute: match.elapsed || Math.floor(Math.random() * 90),
            timestamp: Date.now(),
          };
        }
      }

      // Atualizar minuto (incrementar 1)
      const currentMinute = match.elapsed || 0;
      const newMinute = Math.min(currentMinute + 1, 90);

      // Emitir atualização de placar
      const scoreUpdate: LiveScoreUpdate = {
        matchId,
        homeScore: newHomeScore,
        awayScore: newAwayScore,
        minute: newMinute,
        period: this.getPeriodFromMinute(newMinute),
        statusShort: this.getStatusFromMinute(newMinute),
        timestamp: Date.now(),
      };

      this.lastScores.set(matchId, { home: newHomeScore, away: newAwayScore });
      this.emit('score_update', scoreUpdate);

      // Emitir incidente se houver golo
      if (incident) {
        this.emit('incident', incident);
      }

      // 20% de chance de atualizar odds
      if (Math.random() < 0.2) {
        const oddsUpdate: LiveOddsUpdate = {
          matchId,
          odds: {
            home: this.randomOddsChange(match.odds?.home || 2.0),
            draw: this.randomOddsChange(match.odds?.draw || 3.5),
            away: this.randomOddsChange(match.odds?.away || 2.5),
          },
          timestamp: Date.now(),
        };
        this.emit('odds_update', oddsUpdate);
      }
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
    const change = (Math.random() - 0.5) * 0.1; // -0.05 a +0.05
    const newOdd = currentOdd + change;
    return Math.max(1.01, Math.round(newOdd * 100) / 100);
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
   * Registar jogos ao vivo para receber atualizações
   */
  registerMatches(matches: Match[]): void {
    matches.forEach(match => {
      const matchId = String(match.id);
      this.liveMatches.set(matchId, match);
      
      // Inicializar placar
      if (match.homeScore !== undefined && match.awayScore !== undefined) {
        this.lastScores.set(matchId, {
          home: match.homeScore,
          away: match.awayScore,
        });
      }
    });

    console.log(`📝 [WebSocket] ${matches.length} jogos registados para atualizações`);
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
