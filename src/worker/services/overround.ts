
export function calculateOverround(odds: number[]) { 
  if (!odds.length) return 0; 

  const sum = odds.reduce((acc, o) => {
      if (o <= 0) return acc;
      return acc + 1 / o;
  }, 0); 
  return +(sum * 100).toFixed(2); 
}
