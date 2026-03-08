import WebSocket from 'ws';

export class LiveOddsTracker {
  private apiKey: string;
  private options: any;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private onUpdateCallback: ((data: any) => void) | null = null;

  constructor(apiKey: string, options: any = {}, onUpdate?: (data: any) => void) {
    this.apiKey = apiKey;
    this.options = {
      markets: 'ML,Spread,Totals', // Padrão
      sport: 'football',           // Padrão
      status: 'live',              // Padrão
      ...options
    };
    if (onUpdate) {
      this.onUpdateCallback = onUpdate;
    }
  }

  private buildUrl(): string {
    const params = new URLSearchParams();
    params.append('apiKey', this.apiKey);
    
    if (this.options.markets) params.append('markets', this.options.markets);
    if (this.options.sport) params.append('sport', this.options.sport);
    if (this.options.leagues) params.append('leagues', this.options.leagues);
    if (this.options.eventIds) params.append('eventIds', this.options.eventIds);
    if (this.options.status) params.append('status', this.options.status);
    
    return `wss://api.odds-api.io/v3/ws?${params.toString()}`;
  }

  public connect() {
    const url = this.buildUrl();
    console.log(`[OddsSocket] Connecting to ${url.replace(this.apiKey, '***')}...`);
    
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[OddsSocket] Connected!');
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (err) {
        console.error('[OddsSocket] Error parsing message:', err);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[OddsSocket] Disconnected. Code: ${code}, Reason: ${reason.toString()}`);
      this.reconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[OddsSocket] Error:', err.message);
    });
  }

  private handleMessage(data: any) {
    if (data.type === 'welcome') {
      console.log(`[OddsSocket] Welcome: ${data.message}`);
      console.log(`[OddsSocket] Filters: sports=${data.sport_filter}, status=${data.status_filter}`);
      if (data.warning) console.warn(`[OddsSocket] Warning: ${data.warning}`);
    } else if (data.type === 'updated' || data.type === 'created') {
      if (this.onUpdateCallback) {
        this.onUpdateCallback(data);
      }
    } else if (data.type === 'deleted') {
      // Handle match deletion if necessary
      console.log(`[OddsSocket] Match deleted: ${data.id} at ${data.bookie}`);
    } else if (data.type === 'no_markets') {
      console.log(`[OddsSocket] No markets available for match: ${data.id}`);
    } else if (data.type === 'error') {
      console.error(`[OddsSocket] API Error: ${data.message || JSON.stringify(data)}`);
    } else {
      console.log(`[OddsSocket] Unknown message type: ${data.type}`);
    }
  }

  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`[OddsSocket] Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    } else {
      console.error('[OddsSocket] Max reconnection attempts reached.');
    }
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
