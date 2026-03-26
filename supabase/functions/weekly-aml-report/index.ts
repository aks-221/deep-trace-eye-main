import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sendReportEmail(
  userEmail: string,
  userName: string,
  stats: any,
  period: { from: string; to: string },
  RESEND_API_KEY: string
) {
  if (!RESEND_API_KEY) return;
  const complianceColor = stats.complianceRate >= 75 ? "#10b981" : stats.complianceRate >= 50 ? "#f59e0b" : "#ef4444";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Rapport Hebdomadaire AML</title></head>
<body style="background:#ffffff;font-family:sans-serif;color:#1e293b;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <!-- Header -->
    <div style="background:#0f172a;padding:24px 32px;border-radius:8px 8px 0 0;">
      <div style="font-size:20px;font-weight:bold;color:#ffffff;margin-bottom:4px;">DeepAuditAI</div>
      <div style="font-size:12px;color:#94a3b8;">L'Œil de la Traçabilité · Rapport Hebdomadaire AML</div>
    </div>
    <!-- Subheader -->
    <div style="background:#1e293b;padding:12px 32px;">
      <span style="font-size:13px;color:#94a3b8;">Semaine du <strong style="color:#e2e8f0;">${period.from}</strong> au <strong style="color:#e2e8f0;">${period.to}</strong></span>
      ${userName ? `<span style="float:right;font-size:12px;color:#64748b;">${userName}</span>` : ""}
    </div>
    <!-- KPI Grid -->
    <div style="padding:24px 32px;background:#f8fafc;">
      <div style="font-size:14px;font-weight:600;color:#475569;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em;">Indicateurs Clés de la Semaine</div>
      <table style="width:100%;border-collapse:separate;border-spacing:8px;">
        <tr>
          <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;width:33%;">
            <div style="font-size:28px;font-weight:800;color:#1e293b;">${stats.totalTx}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Transactions analysées</div>
          </td>
          <td style="background:${stats.flaggedTx > 0 ? "#fef2f2" : "#ffffff"};border:1px solid ${stats.flaggedTx > 0 ? "#fca5a5" : "#e2e8f0"};border-radius:8px;padding:16px;text-align:center;width:33%;">
            <div style="font-size:28px;font-weight:800;color:${stats.flaggedTx > 0 ? "#ef4444" : "#1e293b"};">${stats.flaggedTx}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Transactions suspectes</div>
          </td>
          <td style="background:${stats.openAlerts > 0 ? "#fff7ed" : "#ffffff"};border:1px solid ${stats.openAlerts > 0 ? "#fed7aa" : "#e2e8f0"};border-radius:8px;padding:16px;text-align:center;width:33%;">
            <div style="font-size:28px;font-weight:800;color:${stats.openAlerts > 0 ? "#f97316" : "#1e293b"};">${stats.openAlerts}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Alertes ouvertes</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#1e293b;">${stats.strCount}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">STR soumises</div>
          </td>
          <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#1e293b;">${stats.criticalTx}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Tx critiques (≥5M XOF)</div>
          </td>
          <td style="background:${stats.complianceRate < 50 ? "#fef2f2" : stats.complianceRate < 75 ? "#fff7ed" : "#f0fdf4"};border:1px solid ${stats.complianceRate < 50 ? "#fca5a5" : stats.complianceRate < 75 ? "#fed7aa" : "#bbf7d0"};border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:${complianceColor};">${stats.complianceRate}%</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Conformité BCEAO</div>
          </td>
        </tr>
      </table>
    </div>
    <!-- CTA -->
    <div style="padding:24px 32px;text-align:center;background:#ffffff;">
      <p style="font-size:13px;color:#64748b;margin-bottom:16px;">
        Le rapport complet avec analyse IA (résumé exécutif, analyse des risques, cas critiques, recommandations) est disponible dans votre tableau de bord.
      </p>
      <a href="https://deepauditai.app" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Voir le rapport complet →
      </a>
    </div>
    <!-- Footer -->
    <div style="background:#f1f5f9;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">DeepAuditAI · Rapport AML Confidentiel · Zone UEMOA/BCEAO</p>
      <p style="font-size:11px;color:#94a3b8;margin:4px 0 0 0;">Ce rapport est généré automatiquement chaque lundi à 08h00 UTC.</p>
    </div>
  </div>
</body>
</html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "DeepAuditAI <rapport@deepauditai.app>",
      to: [userEmail],
      subject: `📊 Rapport Hebdomadaire AML — Semaine du ${period.from} au ${period.to}`,
      html,
    }),
  });
}

async function generateReportForUser(
  supabase: any,
  userId: string,
  weekAgoStr: string,
  nowStr: string,
  weekAgo: Date,
  LOVABLE_API_KEY: string
) {
  const [txRes, alertRes, strRes, chkRes] = await Promise.all([
    supabase.from("transactions").select("*").eq("user_id", userId).gte("date", weekAgoStr).order("date", { ascending: false }),
    supabase.from("alerts").select("*").eq("user_id", userId).gte("created_at", weekAgo.toISOString()),
    supabase.from("str_reports").select("*").eq("user_id", userId).gte("created_at", weekAgo.toISOString()),
    supabase.from("compliance_checklist").select("*").eq("user_id", userId),
  ]);

  const transactions = txRes.data || [];
  const alerts = alertRes.data || [];
  const strReports = strRes.data || [];
  const checklist = chkRes.data || [];

  const totalTx = transactions.length;
  const flaggedTx = transactions.filter((t: any) => t.flagged).length;
  const totalAmount = transactions.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const highAlerts = alerts.filter((a: any) => a.severity === "high").length;
  const openAlerts = alerts.filter((a: any) => a.status === "open").length;
  const completedChecklist = checklist.filter((c: any) => c.completed).length;
  const complianceRate = checklist.length > 0 ? Math.round((completedChecklist / checklist.length) * 100) : 0;
  const cryptoTx = transactions.filter((t: any) => t.channel === "Crypto");
  const criticalTx = transactions.filter((t: any) => Number(t.amount) >= 5_000_000);

  const topSuspicious = transactions
    .filter((t: any) => t.flagged || Number(t.amount) >= 5_000_000)
    .slice(0, 5)
    .map((t: any) => `  - ${t.ref} | ${t.date} | ${Number(t.amount).toLocaleString("fr-FR")} XOF | Canal: ${t.channel}${t.flagged ? " [SIGNALÉ]" : ""}`)
    .join("\n");

  const systemPrompt = `Tu es un expert en conformité AML/CFT pour la zone UEMOA/BCEAO. 
Tu génères des rapports hebdomadaires de synthèse pour les équipes compliance.
Ton rapport doit être professionnel, structuré, et orienté vers des actions concrètes.
Réponds en français.`;

  const userPrompt = `Génère un rapport hebdomadaire AML pour la semaine du ${weekAgoStr} au ${nowStr}.

DONNÉES DE LA SEMAINE:
- Total transactions analysées: ${totalTx}
- Transactions suspectes signalées: ${flaggedTx}
- Volume total: ${totalAmount.toLocaleString("fr-FR")} XOF
- Alertes ouvertes: ${openAlerts} (dont ${highAlerts} haute sévérité)
- STR soumises: ${strReports.length}
- Transactions Crypto: ${cryptoTx.length}
- Transactions ≥ 5M XOF: ${criticalTx.length}
- Taux conformité BCEAO: ${complianceRate}% (${completedChecklist}/${checklist.length} items)

TRANSACTIONS CRITIQUES:
${topSuspicious || "  Aucune transaction critique cette semaine"}

Génère un rapport avec ces sections:
1. **Résumé Exécutif** (3-4 phrases)
2. **Analyse des Risques** (points clés, tendances)
3. **Cas Critiques** (liste les transactions à haut risque avec recommandations)
4. **Conformité BCEAO** (évaluation et lacunes)
5. **Actions Prioritaires** (3-5 actions concrètes pour la semaine suivante)
6. **Indicateurs Clés** (tableau KPIs)

Sois concis et actionnable.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI gateway error: ${response.status} — ${errBody}`);
  }

  const data = await response.json();
  const reportContent = data.choices?.[0]?.message?.content || "Rapport indisponible";

  const weekLabel = `${weekAgoStr} → ${nowStr}`;
  await supabase.from("reports").insert({
    user_id: userId,
    title: `Rapport Hebdomadaire AML — Semaine du ${weekLabel}`,
    report_type: "weekly_aml",
    content: reportContent,
    status: "published",
  });

  return {
    userId,
    reportContent,
    stats: { totalTx, flaggedTx, totalAmount, openAlerts, highAlerts, strCount: strReports.length, complianceRate, criticalTx: criticalTx.length },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoStr = weekAgo.toISOString().split("T")[0];
    const nowStr = now.toISOString().split("T")[0];

    let body: any = {};
    try { body = await req.json(); } catch {}
    const isScheduled = body?.scheduled === true;

    const authHeader = req.headers.get("Authorization");
    let requestingUserId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      requestingUserId = user?.id || null;
    }

    // --- MULTI-USER SCHEDULED MODE ---
    if (isScheduled) {
      const { data: activeUsers } = await supabase
        .from("transactions")
        .select("user_id")
        .gte("date", weekAgoStr);

      const uniqueUserIds = [...new Set((activeUsers || []).map((r: any) => r.user_id))];

      const results: any[] = [];
      for (const uid of uniqueUserIds) {
        try {
          const result = await generateReportForUser(supabase, uid, weekAgoStr, nowStr, weekAgo, LOVABLE_API_KEY);
          results.push({ userId: uid, status: "success", stats: result.stats });

          // Insert in-app notification for the user
          try {
            await supabase.from("notifications").insert({
              user_id: uid,
              title: "📊 Rapport Hebdomadaire AML généré",
              body: `Semaine du ${weekAgoStr} au ${nowStr} · ${result.stats.strCount} STR · Score moyen: ${result.stats.complianceRate}% · ${result.stats.flaggedTx} tx suspectes`,
              type: "weekly_report",
              metadata: {
                module: "weekly_report",
                period: { from: weekAgoStr, to: nowStr },
                strCount: result.stats.strCount,
                avgScore: result.stats.complianceRate,
                flaggedTx: result.stats.flaggedTx,
                totalTx: result.stats.totalTx,
              },
            });
          } catch (notifErr) {
            console.error(`Notification error for user ${uid}:`, notifErr);
          }

          // Send email if Resend is configured
          if (RESEND_API_KEY) {
            try {
              const { data: authUser } = await supabase.auth.admin.getUserById(uid);
              const userEmail = authUser?.user?.email;
              const { data: profile } = await supabase.from("profiles").select("full_name").eq("user_id", uid).single();
              if (userEmail) {
                await sendReportEmail(userEmail, profile?.full_name || "", result.stats, { from: weekAgoStr, to: nowStr }, RESEND_API_KEY);
              }
            } catch (emailErr) {
              console.error(`Email error for user ${uid}:`, emailErr);
            }
          }

          if (uniqueUserIds.indexOf(uid) < uniqueUserIds.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (err: any) {
          results.push({ userId: uid, status: "error", error: err.message });
        }
      }

      return new Response(JSON.stringify({
        scheduled: true,
        usersProcessed: uniqueUserIds.length,
        emailsSent: RESEND_API_KEY ? true : false,
        results,
        period: { from: weekAgoStr, to: nowStr },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- SINGLE-USER ON-DEMAND MODE ---
    if (!requestingUserId) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await generateReportForUser(supabase, requestingUserId, weekAgoStr, nowStr, weekAgo, LOVABLE_API_KEY);

    // Insert in-app notification
    try {
      await supabase.from("notifications").insert({
        user_id: requestingUserId,
        title: "📊 Rapport Hebdomadaire AML généré",
        body: `Semaine du ${weekAgoStr} au ${nowStr} · ${result.stats.strCount} STR · Score moyen: ${result.stats.complianceRate}% · ${result.stats.flaggedTx} tx suspectes`,
        type: "weekly_report",
        metadata: {
          module: "weekly_report",
          period: { from: weekAgoStr, to: nowStr },
          strCount: result.stats.strCount,
          avgScore: result.stats.complianceRate,
          flaggedTx: result.stats.flaggedTx,
          totalTx: result.stats.totalTx,
        },
      });
    } catch (notifErr) {
      console.error("Notification error:", notifErr);
    }

    return new Response(JSON.stringify({
      report: result.reportContent,
      stats: result.stats,
      period: { from: weekAgoStr, to: nowStr },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("weekly-aml-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
