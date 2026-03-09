
export function shouldSuspendLiveOdds(fixture: any): boolean { 
  const status = fixture.status?.short || fixture.status;
  const elapsed = fixture.elapsed ?? 0; 

  // Active Basketball/US Sports statuses - Do not suspend if elapsed is missing
  const activeStatuses = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'OT', '1st Half', '2nd Half'];
  if (activeStatuses.includes(status)) {
      return false;
  }

  // Suspende nos momentos críticos 
  if (elapsed < 2) return true;        // início 
  if (elapsed > 88) return true;       // final 
  if (fixture.recentGoal) return true; // se você marcar isso 
  
  return false; 
} 
