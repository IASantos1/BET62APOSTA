import { useState } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import DepositPage from './DepositPage';
import { WithdrawForm } from '@/react-app/components/WithdrawForm';

type Tab = 'deposit' | 'withdraw';

export default function PaymentsPage() {
  const { darkMode } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('deposit');
  
  return (
    <div className={`min-h-screen p-4 md:p-8 ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className={`max-w-xl mx-auto rounded-2xl shadow-xl overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`flex-1 py-4 text-center font-medium transition-colors ${
              activeTab === 'deposit' 
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/20' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            Depositar
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`flex-1 py-4 text-center font-medium transition-colors ${
              activeTab === 'withdraw' 
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/20' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            Levantar
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'deposit' ? (
            <DepositPage />
          ) : (
            <WithdrawForm />
          )}
        </div>
      </div>
    </div>
  );
}
