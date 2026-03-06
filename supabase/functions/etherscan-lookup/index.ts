import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const ETHERSCAN_KEY = Deno.env.get('ETHERSCAN_API_KEY');
  if (!ETHERSCAN_KEY) {
    return new Response(JSON.stringify({ error: 'Etherscan API key not configured' }), { status: 500, headers: corsHeaders });
  }

  const { address, network = 'ethereum' } = await req.json();
  if (!address) {
    return new Response(JSON.stringify({ error: 'Address is required' }), { status: 400, headers: corsHeaders });
  }

  // Determine API base URL by network
  const apiBaseUrls: Record<string, string> = {
    ethereum: 'https://api.etherscan.io/api',
    bnb: 'https://api.bscscan.com/api',
    polygon: 'https://api.polygonscan.com/api',
  };

  const baseUrl = apiBaseUrls[network] || apiBaseUrls.ethereum;

  try {
    // Fetch balance and transactions in parallel
    const [balanceRes, txRes] = await Promise.all([
      fetch(`${baseUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_KEY}`),
      fetch(`${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${ETHERSCAN_KEY}`),
    ]);

    const [balanceData, txData] = await Promise.all([balanceRes.json(), txRes.json()]);

    // ETH balance in wei → ETH
    const balanceWei = balanceData.status === '1' ? BigInt(balanceData.result) : BigInt(0);
    const balanceEth = Number(balanceWei) / 1e18;

    // Transactions
    const transactions = txData.status === '1' ? txData.result.slice(0, 20).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(BigInt(tx.value)) / 1e18).toFixed(6),
      gasUsed: tx.gasUsed,
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      isError: tx.isError === '1',
      methodId: tx.methodId,
    })) : [];

    return new Response(JSON.stringify({
      address,
      network,
      balance: balanceEth.toFixed(6),
      balanceRaw: balanceData.result || '0',
      transactionCount: transactions.length,
      transactions,
      apiStatus: {
        balance: balanceData.status,
        transactions: txData.status,
        message: txData.message,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Etherscan API error: ${msg}` }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
