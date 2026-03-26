import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find unread critical_aml notifications older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: unreadNotifs, error } = await supabase
      .from("notifications")
      .select("id, user_id, title, body, type, created_at, metadata")
      .eq("read", false)
      .in("type", ["critical_aml", "compliance"])
      .lt("created_at", twentyFourHoursAgo);

    if (error) throw error;

    if (!unreadNotifs || unreadNotifs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No unread critical notifications older than 24h", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group by user
    const byUser: Record<string, typeof unreadNotifs> = {};
    for (const n of unreadNotifs) {
      if (!byUser[n.user_id]) byUser[n.user_id] = [];
      byUser[n.user_id].push(n);
    }

    // For each user, create a reminder notification (in-app escalation)
    let processed = 0;
    for (const [userId, notifs] of Object.entries(byUser)) {
      // Check if we already sent a reminder in the last 24h to avoid spam
      const { data: existingReminder } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "reminder_alert")
        .gte("created_at", twentyFourHoursAgo)
        .limit(1);

      if (existingReminder && existingReminder.length > 0) continue;

      const count = notifs.length;
      const highestScore = Math.max(...notifs.map(n => n.metadata?.riskScore || 0));

      await supabase.from("notifications").insert({
        user_id: userId,
        title: `⏰ ${count} alerte(s) critique(s) non lue(s) depuis +24h`,
        body: `Vous avez ${count} notification(s) AML/compliance non traitée(s). Score max: ${highestScore}/100. Action requise immédiatement.`,
        type: "reminder_alert",
        metadata: {
          module: "notifications",
          unreadCount: count,
          maxRiskScore: highestScore,
          escalatedAt: new Date().toISOString(),
          originalNotifIds: notifs.map(n => n.id),
        },
      });

      // Log in audit trail
      await supabase.from("audit_logs").insert({
        user_id: userId,
        action: "escalation_reminder",
        resource_type: "notifications",
        details: {
          unread_count: count,
          max_risk_score: highestScore,
          notification_ids: notifs.map(n => n.id),
        },
      });

      processed++;
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${processed} user(s) with unread critical notifications`,
        processed,
        totalUnread: unreadNotifs.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-unread-alerts error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
