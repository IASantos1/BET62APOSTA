import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('🚀 ========== PAYPAL CREATE ORDER ==========');

  try {
    // 1 — Verificar ENV variables
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log('✅ PAYPAL_CLIENT_ID:', paypalClientId ? '✓' : '❌');
    console.log('✅ PAYPAL_CLIENT_SECRET:', paypalClientSecret ? '✓' : '❌');
    console.log('✅ SUPABASE_URL:', supabaseUrl ? '✓' : '❌');
    console.log('✅ SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '❌');

    if (!paypalClientId || !paypalClientSecret || !supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ 
          ok: false,
          error: "Serviço PayPal não configurado. Contacte o suporte.",
          code: "SERVICE_NOT_CONFIGURED"
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2 — Validar autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Não autenticado", code: "MISSING_AUTH" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      console.error('❌ Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Sessão inválida. Faça login novamente.", code: "INVALID_SESSION" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Utilizador autenticado:', user.id);

    // 3 — Validar body
    const { amount, user_id } = await req.json();

    if (user_id !== user.id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Acesso negado", code: "USER_MISMATCH" }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!amount || typeof amount !== 'number' || amount < 10 || amount > 10000) {
      return new Response(
        JSON.stringify({ 
          ok: false,
          error: amount < 10 ? "Valor mínimo é €10" : "Valor máximo é €10.000",
          code: "INVALID_AMOUNT"
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4 — Obter Access Token do PayPal
    console.log('🔑 Obtendo access token PayPal...');
    const authString = btoa(`${paypalClientId}:${paypalClientSecret}`);
    
    const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Erro ao obter token PayPal:', errorText);
      return new Response(
        JSON.stringify({ ok: false, error: "Erro de autenticação PayPal. Tente novamente.", code: "PAYPAL_AUTH_ERROR" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    console.log('✅ Access token obtido');

    // 5 — Criar Order no PayPal
    console.log('📦 Criando order PayPal...');
    const orderResponse = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'EUR',
            value: amount.toFixed(2),
          },
          description: `Depósito BetPT - €${amount.toFixed(2)}`,
        }],
      }),
    });

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      console.error('❌ Erro ao criar order PayPal:', errorText);
      return new Response(
        JSON.stringify({ ok: false, error: "Erro ao criar pagamento PayPal. Tente novamente.", code: "PAYPAL_ORDER_ERROR" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orderData = await orderResponse.json();
    console.log('✅ Order criada:', orderData.id);

    // 6 — Guardar transação pendente
    const { data: transaction, error: insertError } = await supabaseAdmin
      .from("transactions")
      .insert({
        user_id,
        type: "deposit",
        amount,
        status: "pending",
        payment_method: "paypal",
        description: `Depósito PayPal - €${amount.toFixed(2)}`,
        account_details: { paypal_order_id: orderData.id },
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Erro ao inserir transação:', insertError);
      return new Response(
        JSON.stringify({ ok: false, error: "Erro ao registar transação. Tente novamente.", code: "DB_ERROR" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Transação guardada:', transaction.id);

    return new Response(
      JSON.stringify({
        ok: true,
        order_id: orderData.id,
        transaction_id: transaction.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Erro:', error.message);
    return new Response(
      JSON.stringify({ ok: false, error: "Erro interno do servidor. Tente novamente.", code: "INTERNAL_ERROR", details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});