import { apiFetch } from '@/react-app/utils/api';

export type Transaction = {
  type: string;
  status: string;
  amount: number;
  created_at: string;
};

export type Bet = {
  stake: number;
  status: string;
  created_at: string;
};

type BetsResponse = {
  bets?: Bet[];
};

export async function fetchPromotionData() {
  const [transactions, bets] = await Promise.all([
    apiFetch<Transaction[]>('/api/wallet/transactions'),
    apiFetch<BetsResponse>('/api/bets'),
  ]);

  return {
    transactions: transactions ?? [],
    bets: Array.isArray(bets?.bets) ? bets.bets : [],
  };
}
