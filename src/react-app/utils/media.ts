export function sanitizeMediaUrl(url?: string): string {
  const u = String(url || '').trim();
  if (!u) return '';
  try {
    const host = new URL(u).host;
    if (host.includes('api-sports.io') || host.includes('media.api-sports.io')) {
      return `/api/events/media?url=${encodeURIComponent(u)}`;
    }
  } catch {
    // ignore
  }
  return u;
}

