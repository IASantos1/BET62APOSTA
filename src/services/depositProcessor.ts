
import { apiFetch } from '../services/backendClient';

interface DepositResult {
  success: boolean;
  message: string;
  newBalance?: number;
  error?: string;
}

/**
 * Processa um depósito após confirmação do PayPal
 */
export async function processPayPalDeposit(
  orderId: string,
  amount: number,
  _userId: string
): Promise<DepositResult> {
  try {
    const result = await apiFetch('/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        payment_method: 'paypal',
        description: 'Depósito via PayPal',
        external_id: orderId,
      }),
    });

    const newBalance = result.balance ?? 0;

    return {
      success: true,
      message: `Depósito de €${amount.toFixed(2)} confirmado!`,
      newBalance
    };

  } catch (error) {
    console.error('❌ Erro ao processar depósito:', error);
    return {
      success: false,
      message: 'Erro inesperado ao processar depósito',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Verifica o status de um depósito pendente
 */
export async function checkDepositStatus(
  orderId: string,
  userId: string
): Promise<{
  status: 'pending' | 'completed' | 'failed';
  amount?: number;
}> {
  try {
    const data = await apiFetch('/transactions', { method: 'GET' });
    const transactions = (data.transactions || []) as any[];
    const tx = transactions.find((t) => t.external_id === orderId && t.user_id === userId && t.type === 'deposit');
    if (!tx) return { status: 'pending' };
    return { status: tx.status, amount: tx.amount };
  } catch (error) {
    console.error('❌ Erro ao verificar status:', error);
    return { status: 'pending' };
  }
}

/**
 * Sistema de polling para verificar depósitos pendentes
 */
export class DepositMonitor {
  private intervalId: number | null = null;
  private orderId: string;
  private userId: string;
  private onSuccess: (result: DepositResult) => void;
  private onError: (error: string) => void;
  private maxAttempts: number;
  private attempts: number = 0;

  constructor(
    orderId: string,
    userId: string,
    onSuccess: (result: DepositResult) => void,
    onError: (error: string) => void,
    maxAttempts: number = 30
  ) {
    this.orderId = orderId;
    this.userId = userId;
    this.onSuccess = onSuccess;
    this.onError = onError;
    this.maxAttempts = maxAttempts;
  }

  start() {
    console.log('🔄 Iniciando monitorização de depósito...');
    
    this.check();

    this.intervalId = window.setInterval(() => {
      this.check();
    }, 10000);
  }

  private async check() {
    this.attempts++;

    console.log(`🔍 Verificando depósito (tentativa ${this.attempts}/${this.maxAttempts})...`);

    const status = await checkDepositStatus(this.orderId, this.userId);

    if (status.status === 'completed') {
      console.log('✅ Depósito confirmado!');
      this.stop();
      
      if (status.amount) {
        const result = await processPayPalDeposit(this.orderId, status.amount, this.userId);
        this.onSuccess(result);
      }
      return;
    }

    if (status.status === 'failed') {
      console.log('❌ Depósito falhou');
      this.stop();
      this.onError('O pagamento falhou. Por favor, tente novamente.');
      return;
    }

    if (this.attempts >= this.maxAttempts) {
      console.log('⏱️ Tempo limite excedido');
      this.stop();
      this.onError('Tempo limite excedido. Verifique o seu histórico de transações.');
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Monitorização parada');
    }
  }
}
