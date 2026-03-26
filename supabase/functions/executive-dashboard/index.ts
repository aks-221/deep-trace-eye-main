import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify requesting user is superadmin or org_admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Non authentifié" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Non authentifié" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: roleData } = await supabase.rpc("get_user_role", { _user_id: user.id });
    if (!["superadmin", "org_admin"].includes(roleData)) {
      return new Response(JSON.stringify({ error: "Accès réservé aux administrateurs" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const now = new Date();
    const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all data in parallel
    const [txRes, alertRes, strRes, profilesRes, rolesRes, dossiersRes, amlRulesRes] = await Promise.all([
      supabase.from("transactions").select("user_id, amount, flagged, channel, date, created_at"),
      supabase.from("alerts").select("user_id, severity, status, created_at"),
      supabase.from("str_reports").select("user_id, status, created_at"),
      supabase.from("profiles").select("user_id, full_name, organization"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("investigation_dossiers").select("user_id, status, priority, created_at"),
      supabase.from("aml_rules").select("user_id, enabled"),
    ]);

    const transactions = txRes.data || [];
    const alerts = alertRes.data || [];
    const strReports = strRes.data || [];
    const profiles = profilesRes.data || [];
    const userRoles = rolesRes.data || [];
    const dossiers = dossiersRes.data || [];
    const amlRules = amlRulesRes.data || [];

    // --- Global stats ---
    const globalStats = {
      totalUsers: new Set(profiles.map((p: any) => p.user_id)).size,
      totalTransactions: transactions.length,
      totalTransactions7d: transactions.filter((t: any) => new Date(t.created_at) >= new Date(day7Ago)).length,
      totalFlagged: transactions.filter((t: any) => t.flagged).length,
      totalAlerts: alerts.length,
      openAlerts: alerts.filter((a: any) => a.status === "open").length,
      highAlerts: alerts.filter((a: any) => a.severity === "high").length,
      totalSTR: strReports.length,
      pendingSTR: strReports.filter((s: any) => s.status === "draft").length,
      submittedSTR: strReports.filter((s: any) => s.status === "submitted").length,
      openDossiers: dossiers.filter((d: any) => d.status === "open").length,
      criticalDossiers: dossiers.filter((d: any) => d.priority === "critical").length,
      totalVolume: transactions.reduce((s: number, t: any) => s + Number(t.amount || 0), 0),
      cryptoVolume: transactions.filter((t: any) => t.channel === "Crypto").reduce((s: number, t: any) => s + Number(t.amount || 0), 0),
    };

    // --- Per-org / per-user breakdown ---
    const userMap: Record<string, any> = {};
    for (const p of profiles) {
      userMap[p.user_id] = {
        userId: p.user_id,
        name: p.full_name || "Utilisateur",
        organization: p.organization || "N/A",
        role: userRoles.find((r: any) => r.user_id === p.user_id)?.role || "auditor",
        txCount: 0,
        flaggedCount: 0,
        alertCount: 0,
        highAlertCount: 0,
        strCount: 0,
        dossierCount: 0,
        volume: 0,
        complianceScore: 0,
      };
    }

    for (const tx of transactions) {
      if (!userMap[tx.user_id]) continue;
      userMap[tx.user_id].txCount++;
      userMap[tx.user_id].volume += Number(tx.amount || 0);
      if (tx.flagged) userMap[tx.user_id].flaggedCount++;
    }
    for (const a of alerts) {
      if (!userMap[a.user_id]) continue;
      userMap[a.user_id].alertCount++;
      if (a.severity === "high") userMap[a.user_id].highAlertCount++;
    }
    for (const s of strReports) {
      if (userMap[s.user_id]) userMap[s.user_id].strCount++;
    }
    for (const d of dossiers) {
      if (userMap[d.user_id]) userMap[d.user_id].dossierCount++;
    }
    // Compute per-user compliance score (heuristic based on flagged ratio + alerts)
    for (const uid of Object.keys(userMap)) {
      const u = userMap[uid];
      const flaggedRatio = u.txCount > 0 ? u.flaggedCount / u.txCount : 0;
      const alertRatio = u.txCount > 0 ? u.highAlertCount / Math.max(u.txCount, 1) : 0;
      const strRatio = u.flaggedCount > 0 ? u.strCount / u.flaggedCount : 1;
      u.complianceScore = Math.max(0, Math.round(100 - flaggedRatio * 40 - alertRatio * 30 + strRatio * 10));
    }

    const orgBreakdown = Object.values(userMap).sort((a: any, b: any) => b.complianceScore - a.complianceScore);

    // --- Critical cross-org alerts (high severity, last 7 days) ---
    const criticalAlerts = alerts
      .filter((a: any) => a.severity === "high" && new Date(a.created_at) >= new Date(day7Ago))
      .slice(0, 20)
      .map((a: any) => ({
        ...a,
        userOrg: userMap[a.user_id]?.organization || "N/A",
        userName: userMap[a.user_id]?.name || "Inconnu",
      }));

    // --- Channel distribution ---
    const channelDist: Record<string, number> = {};
    for (const tx of transactions) {
      channelDist[tx.channel] = (channelDist[tx.channel] || 0) + 1;
    }

    // --- Weekly trend (last 8 weeks) ---
    const weeklyTrend = [];
    for (let i = 7; i >= 0; i--) {
      const wEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const wStart = new Date(wEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      const wTx = transactions.filter((t: any) => {
        const d = new Date(t.created_at);
        return d >= wStart && d < wEnd;
      });
      weeklyTrend.push({
        week: `S-${i === 0 ? "Act" : i}`,
        txCount: wTx.length,
        flagged: wTx.filter((t: any) => t.flagged).length,
        volume: Math.round(wTx.reduce((s: number, t: any) => s + Number(t.amount || 0), 0) / 1_000_000),
      });
    }

    return new Response(JSON.stringify({
      globalStats,
      orgBreakdown,
      criticalAlerts,
      channelDist,
      weeklyTrend,
      generatedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("executive-dashboard error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
