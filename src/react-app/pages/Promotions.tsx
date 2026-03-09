import { useApp } from '@/react-app/contexts/AppContext';
import { Gift, Info } from 'lucide-react';
import { usePromotionProgress } from '@/react-app/hooks/usePromotionProgress';

export default function Promotions() {
  const { darkMode, user } = useApp();
  const { progress, loading } = usePromotionProgress(user?.id);

  if (loading) {
    return (
      <div className={`min-h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} flex items-center justify-center`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const bonusReceived = Math.min(progress.deposit, 100);
  const rolloverMeta = bonusReceived * 5;
  const depositBlocked = progress.staked < rolloverMeta;

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Banner Hero */}
      <div className="relative bg-gradient-to-r from-blue-900 to-blue-800 text-white py-12 px-4 overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10 transform translate-x-1/4 -translate-y-1/4">
          <Gift size={400} />
        </div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-yellow-400 text-blue-900 text-xs font-bold px-2 py-1 rounded uppercase tracking-wide">
              Novo Cliente
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Bónus de Boas-Vindas
          </h1>
          <p className="text-blue-100 text-lg md:text-xl max-w-2xl mb-8">
            Comece a sua jornada com o pé direito! Receba <span className="font-bold text-yellow-400">100% até 100€</span> no seu primeiro depósito.
            Depósito mínimo: 10€. Rollover: 5x sobre o bónus recebido.
          </p>
          
          {!user ? (
            <button 
              onClick={() => document.dispatchEvent(new CustomEvent('open-auth-modal'))}
              className="bg-yellow-400 text-blue-900 hover:bg-yellow-300 font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:scale-105"
            >
              Registar Agora
            </button>
          ) : (
             <div className="bg-white/10 backdrop-blur-sm p-6 rounded-xl border border-white/20 max-w-xl">
               <div className="flex items-center justify-between mb-4">
                 <h3 className="font-bold text-lg">O seu progresso</h3>
                 <span className="text-sm bg-blue-600 px-3 py-1 rounded-full">
                    {progress.deposit > 0 ? 'Ativo' : 'Pendente'}
                 </span>
               </div>
               
               <div className="space-y-4">
                 {/* Depósito */}
                 <div>
                   <div className="flex justify-between text-sm mb-1">
                     <span className="text-blue-200">Depósito Inicial</span>
                     <span className="font-mono">{progress.deposit.toFixed(2)}€</span>
                   </div>
                   <div className="h-2 bg-blue-950 rounded-full overflow-hidden">
                     <div 
                        className="h-full bg-green-400 transition-all duration-1000"
                        style={{ width: progress.deposit > 0 ? '100%' : '0%' }}
                     />
                   </div>
                 </div>

                 {/* Rollover */}
                 <div>
                   <div className="flex justify-between text-sm mb-1">
                     <span className="text-blue-200">
                        Rollover (Apostado: {progress.staked.toFixed(2)}€)
                     </span>
                     <span className="font-mono">Meta: {rolloverMeta.toFixed(2)}€</span>
                   </div>
                   <div className="h-2 bg-blue-950 rounded-full overflow-hidden">
                     <div 
                        className="h-full bg-yellow-400 transition-all duration-1000"
                        style={{ width: `${Math.min((progress.staked / (rolloverMeta || 1)) * 100, 100)}%` }}
                     />
                   </div>
                 </div>
               </div>

                {progress.deposit > 0 && (
                 <div className="mt-4 pt-4 border-t border-white/10 text-sm text-blue-200 flex gap-2">
                   <Info size={16} className="mt-0.5 shrink-0" />
                   <p>Faltam {Math.max(rolloverMeta - progress.staked, 0).toFixed(2)}€ para libertar o bónus.</p>
                 </div>
                )}
                {progress.deposit > 0 && (
                 <div className="mt-2 text-xs text-blue-100 flex gap-2 items-center">
                   <span className={`px-2 py-0.5 rounded-full font-semibold ${depositBlocked ? 'bg-red-600/80' : 'bg-green-600/80'}`}>
                     {depositBlocked ? 'Depósito com bónus ainda bloqueado' : 'Requisitos de rollover cumpridos'}
                   </span>
                 </div>
                )}
                {depositBlocked && (
                  <p className="text-sm text-yellow-300 mt-1">
                    Seu depósito está temporariamente bloqueado. Para liberar o bónus de {bonusReceived}€, é necessário apostar {rolloverMeta}€.
                    Sacar o depósito agora fará com que você perca o bónus.
                  </p>
                )}
             </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
          <Gift className="text-blue-600" />
          Outras Promoções
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Promo 1 */}
          <div className={`rounded-xl overflow-hidden border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-sm hover:shadow-md transition-shadow`}>
            <div className="h-48 bg-purple-600 relative flex items-center justify-center text-white">
               <span className="text-6xl">🚀</span>
               <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/60 to-transparent p-4">
                 <h3 className="font-bold text-lg">Múltipla Turbinada</h3>
               </div>
            </div>
            <div className="p-6">
              <p className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Aumente os seus ganhos em até 50% nas suas apostas múltiplas com 4 ou mais seleções.
              </p>
              <button className="text-blue-600 font-semibold text-sm hover:underline">Ver Termos & Condições</button>
            </div>
          </div>

          {/* Promo 2 */}
          <div className={`rounded-xl overflow-hidden border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-sm hover:shadow-md transition-shadow`}>
            <div className="h-48 bg-green-600 relative flex items-center justify-center text-white">
               <span className="text-6xl">⚽</span>
               <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/60 to-transparent p-4">
                 <h3 className="font-bold text-lg">Empate Anula</h3>
               </div>
            </div>
            <div className="p-6">
              <p className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Aposte no mercado "Vencedor do Encontro" e receba o seu dinheiro de volta se o jogo terminar 0-0.
              </p>
              <button className="text-blue-600 font-semibold text-sm hover:underline">Ver Termos & Condições</button>
            </div>
          </div>

          {/* Promo 3 */}
          <div className={`rounded-xl overflow-hidden border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-sm hover:shadow-md transition-shadow`}>
            <div className="h-48 bg-orange-600 relative flex items-center justify-center text-white">
               <span className="text-6xl">🛡️</span>
               <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/60 to-transparent p-4">
                 <h3 className="font-bold text-lg">Seguro ACCA</h3>
               </div>
            </div>
            <div className="p-6">
              <p className={`text-sm mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Errou apenas uma seleção na sua múltipla de 5+ jogos? Nós devolvemos o valor apostado em Freebet.
              </p>
              <button className="text-blue-600 font-semibold text-sm hover:underline">Ver Termos & Condições</button>
            </div>
          </div>
        </div>

           <div className={`mt-12 p-6 rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-blue-50 border-blue-100'}`}>
           <h3 className="font-bold text-lg mb-2">📜 Termos & Condições</h3>
           <ul className={`list-disc pl-5 space-y-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
             <li>Todas as promoções estão sujeitas aos Termos e Condições Gerais da plataforma.</li>
             <li>O depósito mínimo para bónus é 10€.</li>
             <li>O bónus de boas-vindas tem valor máximo de 100€ e rollover de 5x sobre o bónus recebido.</li>
             <li>Seu depósito fica temporariamente bloqueado enquanto o bónus não é liberado. Sacar o depósito antes de cumprir o rollover fará com que você perca o bónus.</li>
             <li>O bónus expira 30 dias após o depósito inicial.</li>
             <li>Freebets só permitem sacar o lucro, o valor da freebet em si não é sacável.</li>
             <li>Promoções contínuas semanais (Seguro ACCA, Empate Anula, Múltiplas Turbinadas) concedem recompensas em freebets.</li>
             <li>Freebets devem ser utilizadas em até 7 dias após recebimento.</li>
             <li>Apenas uma promoção ativa por utilizador de cada vez.</li>
             <li>Abuso de bónus ou manipulação de apostas resultará em cancelamento do bónus e possível suspensão da conta.</li>
             <li>A plataforma reserva-se o direito de alterar ou cancelar promoções a qualquer momento.</li>
           </ul>
        </div>
      </div>
    </div>
  );
}
