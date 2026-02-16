import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY;

// Validate that environment variables are defined
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Variáveis do Supabase não configuradas');
  console.error('URL:', supabaseUrl);
  console.error('Key:', supabaseAnonKey ? 'Definida (mas pode ser inválida)' : 'Não definida');
  throw new Error('⚠️ Configuração do Supabase ausente - verifique o arquivo .env');
}

// Validate URL format
if (!supabaseUrl.startsWith('http')) {
  console.error('❌ URL do Supabase inválida:', supabaseUrl);
  throw new Error('⚠️ URL do Supabase inválida - deve começar com https://');
}

// Validate anon key format (Supabase keys start with "eyJ")
if (typeof supabaseAnonKey !== 'string' || supabaseAnonKey.trim().length === 0) {
  console.error('❌ Chave anônima do Supabase inválida');
  throw new Error('⚠️ Chave do Supabase inválida - verifique o arquivo .env');
}

// Check if it's actually a Supabase key (should start with "eyJ" for JWT)
if (!supabaseAnonKey.startsWith('eyJ')) {
  console.error('❌ A chave fornecida não parece ser uma chave válida do Supabase');
  console.error('Chave atual começa com:', supabaseAnonKey.substring(0, 20) + '...');
  console.warn('⚠️ ATENÇÃO: A chave parece ser do Stripe (sb_publishable_...) em vez do Supabase!');
  console.warn('📝 A chave correta do Supabase deve começar com "eyJ" e ser um token JWT');
  throw new Error('⚠️ Chave do Supabase inválida - use a chave "anon/public" do painel do Supabase');
}

console.log('✅ Supabase configurado:', supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'X-Client-Info': 'supabase-js-web',
    },
  },
  db: {
    schema: 'public',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
