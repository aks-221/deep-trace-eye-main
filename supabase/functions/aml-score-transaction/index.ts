import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { transaction, allTransactions } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const amount = Number(transaction.amount || 0);
    const recent = (allTransactions || [])
      .filter((t: any) => t.account === transaction.account && t.id !== transaction.id)
      .slice(0, 5)
      .map((t: any) => `  - Réf: ${t.ref} | ${t.date} | ${t.amount} XOF | Canal: ${t.channel}`)
      .join("\n");

    const systemPrompt = `Tu es un moteur AML expert en détection de fraude financière pour la zone UEMOA/BCEAO.
Tu analyses une transaction individuelle et fournis une évaluation de risque en JSON structuré.
Tu dois retourner UNIQUEMENT un JSON valide, sans aucun markdown, sans balises, sans commentaires.`;

    const userPrompt = `Analyse cette transaction AML:
Transaction:
- Référence: ${transaction.ref}
- Compte: ${transaction.account}
- Montant: ${amount} XOF
- Canal: ${transaction.channel}
- Date: ${transaction.date}

Historique du compte (5 dernières transactions):
${recent || "  Aucune transaction précédente"}

RÈGLES DE SCORING (BCEAO/FATF):
- Montant ≥ 5 000 000 XOF: risque élevé (+40)
- Montant rond (multiple de 100 000): +20
- Structuration sous seuil (2 700 000 - 3 000 000): +30
- Canal Crypto: +15
- P2P > 1 000 000 XOF: +10
- Plusieurs transactions même compte: +25

Retourne UNIQUEMENT ce JSON (sans backticks):
{
  "riskScore": <0-100>,
  "riskLevel": "<faible|moyen|élevé|critique>",
  "recommendedAction": "<surveiller|signaler|declarer_STR|bloquer>",
  "reasons": ["<raison1>", "<raison2>"],
  "explanation": "<explication courte en 2-3 phrases>",
  "typologies": ["<smurfing|structuration|layering|crypto_mixing|none>"]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 400,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requêtes atteinte." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits insuffisants." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "{}";

    // Strip any possible markdown wrapping
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result: any;
    try {
      result = JSON.parse(cleaned);
    } catch {
      // Fallback if JSON parsing fails
      result = {
        riskScore: amount >= 5_000_000 ? 75 : amount >= 3_000_000 ? 45 : 20,
        riskLevel: amount >= 5_000_000 ? "élevé" : amount >= 3_000_000 ? "moyen" : "faible",
        recommendedAction: amount >= 5_000_000 ? "declarer_STR" : amount >= 3_000_000 ? "signaler" : "surveiller",
        reasons: ["Analyse IA indisponible — règles statiques appliquées"],
        explanation: "Scoring basé sur les seuils BCEAO standards.",
        typologies: ["none"],
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("aml-score-transaction error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
