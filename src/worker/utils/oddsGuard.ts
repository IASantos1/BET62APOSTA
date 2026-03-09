
export function isPreMatch(fixture: any): boolean { 
  if (!fixture) return false; 

  // API-Football statuses 
  // NS = Not Started 
  return fixture.status?.short === 'NS' || fixture.status === 'NS'; 
} 
