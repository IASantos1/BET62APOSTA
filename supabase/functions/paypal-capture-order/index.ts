
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

  console.log('🚀 ========== PAYPAL CAPTURE ORDER ==========');

  try {
    // 1 — Verificar ENV variables
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    const paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!paypalClientId || !paypalClientSecret || !supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Serviço não configurado", code: "SERVICE_NOT_CONFIGURED" }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2 — Validar autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Não autenticado", code: "MISSING_AUTH" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Sessão inválida", code: "INVALID_SESSION" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Utilizador autenticado:', user.id);

    // 3 — Validar body
    const { order_id, user_id } = await req.json();

    if (user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Acesso negado", code: "USER_MISMATCH" }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: "Order ID em falta", code: "MISSING_ORDER_ID" }),
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
      return new Response(
        JSON.stringify({ error: "Erro de autenticação PayPal", code: "PAYPAL_AUTH_ERROR" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 5 — Capturar pagamento no PayPal
    console.log('💰 Capturando pagamento PayPal...');
    const captureResponse = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${order_id}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const captureData = await captureResponse.json();

    if (!captureResponse.ok || captureData.status !== 'COMPLETED') {
      console.error('❌ Erro ao capturar pagamento:', captureData);
      return new Response(
        JSON.stringify({ 
          error: "Pagamento não foi completado", 
          code: "CAPTURE_FAILED",
          details: captureData 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Pagamento capturado:', captureData.id);

    // 6 — Extrair valor do pagamento
    const capturedAmount = parseFloat(
      captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || '0'
    );

    // 7 — Atualizar transação para completed
    const { error: updateError } = await supabaseAdmin
      .from("transactions")
      .update({ 
        status: "completed",
        account_details: { 
          paypal_order_id: order_id,
          paypal_capture_id: captureData.id,
          payer_email: captureData.payer?.email_address,
        }
      })
      .eq("user_id", user_id)
      .contains("account_details", { paypal_order_id: order_id });

    if (updateError) {
      console.error('❌ Erro ao atualizar transação:', updateError);
    }

    // 8 — Atualizar saldo do utilizador
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("balance")
      .eq("id", user_id)
      .maybeSingle();

    if (profile) {
      const newBalance = (profile.balance || 0) + capturedAmount;
      await supabaseAdmin
        .from("profiles")
        .update({ balance: newBalance })
        .eq("id", user_id);
      
      console.log('✅ Saldo atualizado:', newBalance);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: 'COMPLETED',
        amount: capturedAmount,
        capture_id: captureData.id,
        payer_email: captureData.payer?.email_address,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Erro:', error.message);
    return new Response(
      JSON.stringify({ error: "Erro interno", code: "INTERNAL_ERROR", details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
