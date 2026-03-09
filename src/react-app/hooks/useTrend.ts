import { useState, useMemo, useEffect } from 'react';

export const useTrend = (val: number) => {
    const [trend, setTrend] = useState<'up' | 'down' | 'stable'>('stable');
    const prev = useMemo(() => ({ value: val }), []); // Stable ref container

    if (val !== prev.value) {
        if (val > prev.value) setTrend('up');
        else if (val < prev.value) setTrend('down');
        prev.value = val;
    }

    // Auto-reset trend effect
    useEffect(() => {
        if (trend !== 'stable') {
            const t = setTimeout(() => setTrend('stable'), 5000);
            return () => clearTimeout(t);
        }
    }, [trend]);

    return trend;
};
