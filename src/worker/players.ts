import { Hono } from 'hono';
import { Env } from '../shared/types';

const players = new Hono<{ Bindings: Env }>();

// All endpoints disabled/removed as per cleanup request
// preventing any connection to external player APIs (API-Sports, etc.)

players.get('/seasons', (c) => c.json([]));
players.get('/', (c) => c.json([]));
players.get('/squads', (c) => c.json([]));
players.get('/teams', (c) => c.json([]));

export default players;
