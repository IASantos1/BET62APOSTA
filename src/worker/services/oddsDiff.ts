export function diffEvents(prev: any[], next: any[]) {
  const prevMap = new Map(prev.map(e => [e.id, JSON.stringify(e.odds)]));
  const changes = [];

  for (const ev of next) {
    const serialized = JSON.stringify(ev.odds);
    if (prevMap.get(ev.id) !== serialized) {
      changes.push(ev);
    }
  }

  return changes;
}
