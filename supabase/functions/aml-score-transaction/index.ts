import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { transaction, allTransactions, customRules } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const amount = Number(transaction.amount || 0);
    const recent = (allTransactions || [])
      .filter((t: any) => t.account === transaction.account && t.id !== transaction.id)
      .slice(0, 5)
      .map((t: any) => `  - Réf: ${t.ref} | ${t.date} | ${t.amount} XOF | Canal: ${t.channel}`)
      .join("\n");

    // ---- Apply custom org rules pre-scoring ----
    let customPreScore = 0;
    const triggeredRules: Array<{ name: string; description?: string; impact: number; action: string }> = [];

    if (customRules && Array.isArray(customRules)) {
      for (const rule of customRules.filter((r: any) => r.enabled)) {
        let triggered = false;
        if (rule.rule_type === "threshold" && rule.amount_threshold != null) {
          const thresh = Number(rule.amount_threshold);
          const op = rule.amount_operator || ">";
          triggered = op === ">" ? amount > thresh
            : op === ">=" ? amount >= thresh
            : op === "<" ? amount < thresh
            : op === "<=" ? amount <= thresh
            : amount === thresh;
        } else if (rule.rule_type === "channel" && Array.isArray(rule.target_channels)) {
          triggered = rule.target_channels.includes(transaction.channel);
        } else if (rule.rule_type === "typology" && Array.isArray(rule.typology_keywords)) {
          const text = `${transaction.ref || ""} ${transaction.notes || ""}`.toLowerCase();
          triggered = rule.typology_keywords.some((k: string) => text.includes(k.toLowerCase()));
        }
        if (triggered) {
          customPreScore += rule.score_impact;
          triggeredRules.push({
            name: rule.name,
            description: rule.description,
            impact: rule.score_impact,
            action: rule.score_action,
          });
        }
      }
      customPreScore = Math.min(customPreScore, 100);
    }

    // Format triggered rules for prompt
    const customRulesSection = triggeredRules.length > 0
      ? `\nRÈGLES ORGANISATIONNELLES DÉCLENCHÉES (pré-score: +${customPreScore}):\n` +
        triggeredRules.map(r => `- ${r.name} (+${r.impact} pts, action: ${r.action})`).join("\n")
      : "";

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

RÈGLES DE SCORING STANDARD (BCEAO/FATF):
- Montant ≥ 5 000 000 XOF: risque élevé (+40)
- Montant rond (multiple de 100 000): +20
- Structuration sous seuil (2 700 000 - 3 000 000): +30
- Canal Crypto: +15
- P2P > 1 000 000 XOF: +10
- Plusieurs transactions même compte: +25
${customRulesSection}

${triggeredRules.length > 0 ? `Note: Le pré-score organisationnel est de +${customPreScore} pts. Intègre ces règles déclenchées dans ton analyse et ta narration.` : ""}

Retourne UNIQUEMENT ce JSON (sans backticks):
{
  "riskScore": <0-100, en tenant compte du pré-score organisationnel de ${customPreScore}>,
  "riskLevel": "<faible|moyen|élevé|critique>",
  "recommendedAction": "<surveiller|signaler|declarer_STR|bloquer>",
  "reasons": ["<raison1>", "<raison2>"],
  "explanation": "<explication courte en 2-3 phrases incluant les règles organisationnelles déclenchées>",
  "typologies": ["<smurfing|structuration|layering|crypto_mixing|none>"],
  "customRulesTriggered": ${JSON.stringify(triggeredRules.map(r => r.name))}
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
        max_tokens: 500,
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

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result: any;
    try {
      result = JSON.parse(cleaned);
    } catch {
      const fallbackScore = Math.min(
        (amount >= 5_000_000 ? 40 : amount >= 3_000_000 ? 20 : 0) + customPreScore,
        100
      );
      result = {
        riskScore: fallbackScore,
        riskLevel: fallbackScore >= 70 ? "élevé" : fallbackScore >= 40 ? "moyen" : "faible",
        recommendedAction: fallbackScore >= 70 ? "declarer_STR" : fallbackScore >= 40 ? "signaler" : "surveiller",
        reasons: ["Analyse IA indisponible — règles statiques appliquées"],
        explanation: `Scoring basé sur les seuils BCEAO standards${triggeredRules.length > 0 ? ` et ${triggeredRules.length} règle(s) organisationnelle(s)` : ""}.`,
        typologies: ["none"],
        customRulesTriggered: triggeredRules.map(r => r.name),
      };
    }

    // Ensure customRulesTriggered is always present
    if (!result.customRulesTriggered) {
      result.customRulesTriggered = triggeredRules.map(r => r.name);
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
