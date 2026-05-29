import type { MouseEvent as ReactMouseEvent } from 'react';

interface OddButtonProps {
  label: string;
  price: number;
  onClick: (e: ReactMouseEvent) => void;
  className?: string;
  teamName?: string;
  suspended?: { reason: string };
  trend?: 'up' | 'down' | 'stable';
}

export function OddButton({ label, price, onClick, className = '', teamName, suspended, trend = 'stable' }: OddButtonProps) {
  const isSuspended = !!suspended;
  const priceStr = Number.isFinite(price) && price > 0 ? price.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';

  return (
    <div className="relative w-full h-full">
      <button 
        onClick={isSuspended ? undefined : onClick} 
        disabled={isSuspended}
        className={`
          ${className} 
          transition-all duration-300 
          ${isSuspended ? 'opacity-50 cursor-not-allowed select-none bg-gray-700/50' : ''}
        `}
      >
         <div className="flex justify-between items-center w-full px-1">
           <span className="text-[11px] sm:text-sm font-normal text-left truncate flex-1 min-w-0 mr-1">
             {teamName || label}
           </span>
           <div className="flex items-center gap-1 flex-shrink-0">
              {!isSuspended && trend === 'up' && (
                <span className="text-green-300 animate-bounce text-[10px] sm:text-xs">▲</span>
              )}
              {!isSuspended && trend === 'down' && (
                <span className="text-black dark:text-gray-400 animate-bounce text-[10px] sm:text-xs">▼</span>
              )}
              <span className={`text-sm sm:text-base font-bold tabular-nums ${
                isSuspended ? 'text-gray-400' :
                trend === 'up' ? 'text-green-200' : 
                trend === 'down' ? 'text-black dark:text-gray-400' : 'text-white'
              }`}>
                {priceStr}
              </span>
           </div>
         </div>
         {/* Lock Icon Overlay for Suspended State */}
         {isSuspended && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            </div>
         )}
      </button>
      {isSuspended && suspended?.reason && (
        <div className="absolute -top-2 right-0 z-20 pointer-events-none">
          <span className={`
            text-[9px] px-1.5 py-0.5 rounded shadow-sm font-bold uppercase tracking-wider backdrop-blur-sm border whitespace-nowrap
            ${suspended.reason === 'GOAL' ? 'bg-red-600/90 text-white border-red-500' : 
              suspended.reason === 'VAR' ? 'bg-yellow-600/90 text-white border-yellow-500' :
              suspended.reason === 'CHANCE' ? 'bg-rose-600/90 text-white border-rose-500' :
              suspended.reason === 'PENALTY' ? 'bg-orange-600/90 text-white border-orange-500' :
              suspended.reason === 'CARD' ? 'bg-orange-600/90 text-white border-orange-500' :
              'bg-gray-600/90 text-gray-200 border-gray-500'}
          `}>
            {suspended.reason === 'GOAL' ? 'GOL' : 
             suspended.reason === 'VAR' ? 'VAR' : 
             suspended.reason === 'CHANCE' ? 'CHANCE' :
             suspended.reason === 'PENALTY' ? 'PÊNALTI' :
             suspended.reason === 'CARD' ? 'CARTÃO' : 
             suspended.reason}
          </span>
        </div>
      )}
    </div>
  );
}
