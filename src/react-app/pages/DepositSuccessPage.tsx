import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/react-app/utils/api';
import { useApp } from '@/react-app/contexts/AppContext';

export default function DepositSuccessPage() {
  const { darkMode, user } = useApp();
  const navigate = useNavigate();
  const [eurBalance, setEurBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'done'>('loading');

  const title = useMemo(() => {
    if (!user) return 'Depósito iniciado';
    return 'Depósito iniciado';
  }, [user]);

  useEffect(() => {
    let stopped = false;
    const fireRefresh = () => {
      try { window.dispatchEvent(new Event('wallet:refresh')); } catch { void 0; }
    };
    const load = async () => {
      if (!user) { setStatus('done'); return; }
      try {
        const d = await apiFetch<{ currency: string; balance: number }[]>('/api/wallet/balances', { cache: 'no-store' });
        if (stopped) return;
        const eur = d.find((x) => x.currency === 'EUR');
        setEurBalance(eur ? eur.balance : 0);
      } catch { void 0; }
    };

    const run = async () => {
      fireRefresh();
      await load();
      const started = Date.now();
      while (!stopped && Date.now() - started < 30_000) {
        await new Promise((r) => setTimeout(r, 3000));
        fireRefresh();
        await load();
      }
      if (!stopped) setStatus('done');
    };
    run();
    return () => { stopped = true; };
  }, [user]);

  return (
    <div className={`max-w-xl mx-auto p-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <div className="rounded-xl border p-5">
        <div className="text-lg font-extrabold">{title}</div>
        <div className={`mt-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Se foi Cartão, o saldo atualiza em segundos. Se foi Multibanco/MB WAY, o saldo só atualiza após confirmação do pagamento.
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            Saldo EUR: <span className="font-extrabold">{eurBalance === null ? '—' : eurBalance.toFixed(2)} €</span>
          </div>
          <div className={`text-xs font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {status === 'loading' ? 'A atualizar...' : 'Atualizado'}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { try { window.dispatchEvent(new Event('wallet:refresh')); } catch { void 0; } }}
            className={`py-3 rounded-lg font-extrabold border ${darkMode ? 'border-gray-700 bg-gray-900/40 text-white hover:bg-gray-900/60' : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50'}`}
          >
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => navigate('/wallet')}
            className="py-3 rounded-lg font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Ir para saldo
          </button>
        </div>
      </div>
    </div>
  );
}

