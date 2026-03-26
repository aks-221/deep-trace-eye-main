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

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const { address, network = 'ethereum' } = await req.json();
  if (!address) {
    return new Response(JSON.stringify({ error: 'Address is required' }), { status: 400, headers: corsHeaders });
  }

  // Try to get user's own API key from api_keys table first
  let ETHERSCAN_KEY: string | null = null;
  
  const serviceMap: Record<string, string> = {
    ethereum: 'etherscan',
    bnb: 'bscscan',
    polygon: 'polygonscan',
  };
  
  const serviceName = serviceMap[network] || 'etherscan';
  
  // Check user's custom key first, then fallback to env var
  const { data: userKey } = await supabase
    .from('api_keys')
    .select('api_key')
    .eq('service_name', serviceName)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  ETHERSCAN_KEY = userKey?.api_key || Deno.env.get('ETHERSCAN_API_KEY');
  
  if (!ETHERSCAN_KEY) {
    return new Response(JSON.stringify({ 
      error: `No API key configured for ${serviceName}. Please add your API key in Settings > Connectors.` 
    }), { status: 400, headers: corsHeaders });
  }

  // Determine API base URL by network
  const apiBaseUrls: Record<string, string> = {
    ethereum: 'https://api.etherscan.io/api',
    bnb: 'https://api.bscscan.com/api',
    polygon: 'https://api.polygonscan.com/api',
  };

  const baseUrl = apiBaseUrls[network] || apiBaseUrls.ethereum;

  try {
    // Fetch balance, transactions, and internal transactions in parallel
    const [balanceRes, txRes, internalTxRes] = await Promise.all([
      fetch(`${baseUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_KEY}`),
      fetch(`${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=25&sort=desc&apikey=${ETHERSCAN_KEY}`),
      fetch(`${baseUrl}?module=account&action=txlistinternal&address=${address}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey=${ETHERSCAN_KEY}`),
    ]);

    const [balanceData, txData, internalTxData] = await Promise.all([
      balanceRes.json(), txRes.json(), internalTxRes.json(),
    ]);

    // ETH balance in wei → ETH
    const balanceWei = balanceData.status === '1' ? BigInt(balanceData.result) : BigInt(0);
    const balanceEth = Number(balanceWei) / 1e18;

    // Transactions
    const transactions = txData.status === '1' ? txData.result.slice(0, 25).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(BigInt(tx.value)) / 1e18).toFixed(6),
      gasUsed: tx.gasUsed,
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      isError: tx.isError === '1',
      methodId: tx.methodId,
      blockNumber: tx.blockNumber,
      functionName: tx.functionName || null,
    })) : [];

    // Internal transactions
    const internalTransactions = internalTxData.status === '1' ? internalTxData.result.slice(0, 10).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(BigInt(tx.value)) / 1e18).toFixed(6),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      isError: tx.isError === '1',
      type: tx.type,
    })) : [];

    // Compute flow analysis
    const totalIn = transactions
      .filter((tx: any) => tx.to?.toLowerCase() === address.toLowerCase())
      .reduce((sum: number, tx: any) => sum + parseFloat(tx.value), 0);
    const totalOut = transactions
      .filter((tx: any) => tx.from?.toLowerCase() === address.toLowerCase())
      .reduce((sum: number, tx: any) => sum + parseFloat(tx.value), 0);

    // Unique counterparties
    const counterparties = new Set<string>();
    transactions.forEach((tx: any) => {
      if (tx.from?.toLowerCase() !== address.toLowerCase()) counterparties.add(tx.from);
      if (tx.to?.toLowerCase() !== address.toLowerCase() && tx.to) counterparties.add(tx.to);
    });

    return new Response(JSON.stringify({
      address,
      network,
      balance: balanceEth.toFixed(6),
      balanceRaw: balanceData.result || '0',
      transactionCount: transactions.length,
      transactions,
      internalTransactions,
      flowAnalysis: {
        totalIn: totalIn.toFixed(6),
        totalOut: totalOut.toFixed(6),
        netFlow: (totalIn - totalOut).toFixed(6),
        uniqueCounterparties: counterparties.size,
      },
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
