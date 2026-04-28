export default function handler(_req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(
    JSON.stringify([
      { id: 'soccer', name: 'Futebol', active: true },
      { id: 'basketball', name: 'Basquetebol', active: true },
      { id: 'tennis', name: 'Tênis', active: true },
      { id: 'ice-hockey', name: 'Hóquei no Gelo', active: true },
      { id: 'mma', name: 'MMA', active: true },
      { id: 'american-football', name: 'Futebol Americano', active: true },
      { id: 'baseball', name: 'Beisebol', active: true },
      { id: 'handball', name: 'Handebol', active: true },
      { id: 'rugby', name: 'Rúgbi', active: true },
      { id: 'volleyball', name: 'Voleibol', active: true },
      { id: 'formula1', name: 'Fórmula 1', active: true },
      { id: 'boxing', name: 'Boxe', active: true }
    ])
  );
}
