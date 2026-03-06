import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { alert, transactions } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const txSummary = (transactions || []).slice(0, 20).map((t: any) =>
      `- ${t.date} | Réf: ${t.ref} | Compte: ${t.account} | Montant: ${t.amount} XOF | Canal: ${t.channel}${t.flagged ? " [SIGNALÉ]" : ""}`
    ).join("\n");

    const systemPrompt = `Tu es un expert en lutte contre le blanchiment d'argent (AML/LBC) spécialisé dans la zone UEMOA/BCEAO. 
Tu analyses des alertes financières suspectes et génères des narrations d'investigation en français, structurées et conformes aux normes FATF/CENTIF.
Tes analyses sont concises (max 250 mots), professionnelles et orientées action.`;

    const userPrompt = `ALERTE AML DÉTECTÉE:
Titre: ${alert.title}
Description: ${alert.description || "N/A"}
Sévérité: ${alert.severity}
Date: ${new Date(alert.created_at).toLocaleDateString("fr-FR")}

CONTEXTE TRANSACTIONNEL (dernières transactions):
${txSummary || "Aucune transaction disponible"}

MISSION: Génère une narration d'investigation structurée incluant:
1. Résumé du risque identifié
2. Analyse des patterns suspects
3. Liens potentiels avec des typologies connues (smurfing, structuration, crypto-layering)
4. Recommandations d'investigation immédiates
5. Décision: Escalader aux autorités (Oui/Non) et pourquoi`;

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
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requêtes atteinte, veuillez réessayer." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits insuffisants pour l'IA." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const narrative = data.choices?.[0]?.message?.content || "Analyse non disponible.";

    return new Response(JSON.stringify({ narrative }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("aml-analyze error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
