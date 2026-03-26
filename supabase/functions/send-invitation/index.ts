import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Non authentifié");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { invitationId } = await req.json();
    if (!invitationId) throw new Error("invitationId requis");

    // Fetch the invitation
    const { data: inv, error: invError } = await supabase
      .from("org_invitations")
      .select("*")
      .eq("id", invitationId)
      .single();

    if (invError || !inv) throw new Error("Invitation introuvable");
    if (inv.status !== "pending") throw new Error("Invitation déjà traitée");

    // Build activation URL — use the project URL or fallback
    const appUrl = Deno.env.get("APP_URL") || "https://deepauditai.lovable.app";
    const activationUrl = `${appUrl}/auth?invitation=${inv.token}&email=${encodeURIComponent(inv.email)}&role=${inv.role}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // No email service — just return the link
      return new Response(JSON.stringify({ success: true, activationUrl, emailSent: false, reason: "LOVABLE_API_KEY not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build HTML email body
    const roleLabels: Record<string, string> = {
      superadmin: "Super Administrateur",
      org_admin: "Administrateur Organisation",
      compliance_manager: "Responsable Conformité",
      analyst: "Analyste",
      forensic_analyst: "Analyste Forensique",
      auditor: "Auditeur",
      read_only: "Lecture Seule",
    };
    const roleLabel = roleLabels[inv.role] || inv.role;
    const expiry = new Date(inv.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);padding:32px 40px;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">🛡 DeepAuditAI</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:4px;">L'Œil de la Traçabilité Financière</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Vous avez été invité(e) !</h1>
            <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
              Vous avez reçu une invitation à rejoindre la plateforme <strong>DeepAuditAI</strong> en tant que <strong>${roleLabel}</strong>.
            </p>

            <!-- Role card -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
              <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Rôle assigné</div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;">${roleLabel}</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px;">Valide jusqu'au ${expiry}</div>
            </div>

            <!-- CTA -->
            <a href="${activationUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;margin-bottom:24px;">
              Activer mon compte →
            </a>

            <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;">Ou copiez ce lien dans votre navigateur :</p>
            <p style="margin:0 0 24px;color:#3b82f6;font-size:11px;word-break:break-all;">${activationUrl}</p>

            <div style="border-top:1px solid #e2e8f0;padding-top:16px;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet email.<br>
                Ce lien expire le <strong>${expiry}</strong>.
              </p>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <div style="font-size:12px;color:#94a3b8;">DeepAuditAI · Plateforme de Surveillance AML UEMOA/BCEAO</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Send via Lovable AI gateway (email capability) — using resend-compatible format via LOVABLE_API_KEY
    // We'll use Resend if available, otherwise just log
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;

    if (RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "DeepAuditAI <noreply@deepauditai.lovable.app>",
          to: [inv.email],
          subject: `Invitation DeepAuditAI — Rôle : ${roleLabel}`,
          html: htmlBody,
        }),
      });
      emailSent = emailRes.ok;
      if (!emailRes.ok) {
        const errBody = await emailRes.text();
        console.warn("Resend email failed:", errBody);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      activationUrl, 
      emailSent,
      message: emailSent 
        ? `Email d'invitation envoyé à ${inv.email}` 
        : `Invitation créée. Lien d'activation généré (email non configuré).`
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("send-invitation error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
