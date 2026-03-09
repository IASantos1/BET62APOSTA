import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { Settings } from '@/react-app/components/Settings';
import { apiFetch } from '@/react-app/utils/api';

interface User {
  id: string;
  email: string;
  is_operator: number;
}

const AdminPanel: React.FC = () => {
  const { darkMode, setShowAdminPanel } = useApp();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [tab, setTab] = useState<'users' | 'settings'>('settings');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        let d: User[] = [];
        try {
          d = await apiFetch<User[]>('/api/admin/users', { cache: 'no-store' });
        } catch (e: any) {
          if (String(e).includes('401') && import.meta.env.DEV) {
            await apiFetch('/api/dev/recreate-admin', { method: 'POST' });
            d = await apiFetch<User[]>('/api/admin/users', { cache: 'no-store' });
          } else {
            throw e;
          }
        }
        if (alive) setUsers(Array.isArray(d) ? d : []);
      } catch {
        if (alive) setUsers([]);
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  const toggleOperator = async (userId: string, isOperator: boolean) => {
    try {
      await apiFetch(`/api/admin/users/${userId}/toggle-operator`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_operator: isOperator }),
      });

      setUsers(users.map(user => 
          user.id === userId ? { ...user, is_operator: isOperator ? 1 : 0 } : user
      ));
    } catch {
       // Ignore or handle error
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Painel de Administração</h2>
        <button
          onClick={() => setShowAdminPanel(false)}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Voltar</button>
      </div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('users')}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${tab==='users' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Utilizadores</button>
        <button
          onClick={() => setTab('settings')}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${tab==='settings' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Configurações</button>
        <button
          onClick={() => { setShowAdminPanel(false); navigate('/admin/withdrawals'); }}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Levantamentos</button>
        <button
          onClick={() => { setShowAdminPanel(false); navigate('/admin/payouts'); }}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Pagamentos</button>
        <button
          onClick={() => { setShowAdminPanel(false); navigate('/admin/risk'); }}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Risco & Fraude</button>
        <button
          onClick={() => { setShowAdminPanel(false); navigate('/admin/kyc'); }}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'}`}
        >KYC</button>
        <button
          onClick={() => { setShowAdminPanel(false); navigate('/metrics'); }}
          className={`px-3 py-2 rounded-md text-sm font-semibold ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'}`}
        >Métricas</button>
      </div>
      {tab === 'settings' ? (
        <div className="max-w-xl">
          <Settings />
        </div>
      ) : (
        <table className="min-w-full bg-white">
          <thead>
            <tr>
              <th className="py-2">Email</th>
              <th className="py-2">Operador</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td className="border px-4 py-2">{user.email}</td>
                <td className="border px-4 py-2">
                  <input 
                    type="checkbox" 
                    checked={!!user.is_operator}
                    onChange={(e) => toggleOperator(user.id, e.target.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default AdminPanel;
