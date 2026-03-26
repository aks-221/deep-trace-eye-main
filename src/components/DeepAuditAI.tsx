import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, Legend, RadialBarChart, RadialBar,
} from "recharts";
import jsPDF from "jspdf";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  useTransactions, useCreateTransaction, useUpdateTransaction,
  useAlerts, useCreateAlert,
  useBlockchainAddresses, useAddBlockchainAddress,
  useReports, useCreateReport,
  useProfile, useUpdateProfile,
  useCreateNotification,
  useAMLRules,
} from "@/hooks/useSupabaseData";
import {
  useUserRole, useAllUserRoles, useAssignRole, useRevokeRole,
  useOrgInvitations, useCreateInvitation, useEtherscanLookup, useAuditLogs,
  type AppRole
} from "@/hooks/useRBAC";
import { supabase } from "@/integrations/supabase/client";
import LeafletMap from "@/components/LeafletMap";
import NotificationsPanel from "@/components/NotificationsPanel";
import AMLRulesEngine from "@/components/AMLRulesEngine";
import InvestigationDossiers from "@/components/InvestigationDossiers";
import AuditLogsDashboard from "@/components/AuditLogsDashboard";
import { useTheme } from "@/hooks/useTheme";
import { useLanguage } from "@/hooks/useLanguage";
import { LogOut, Plus, RefreshCw, AlertTriangle, Shield, BarChart2, Map, FileText, Settings as SettingsIcon, Home, List, Search, Bell, Users, Activity, Upload, Network, TrendingUp, Globe, Brain, Zap, CheckCircle2, XCircle, FolderOpen, BarChart3, Building2, AlertOctagon, CheckSquare, Clock, Sun, Moon, Languages } from "lucide-react";

// ---- Critical alert sound ----
function playCriticalSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gainNode.gain.setValueAtTime(0.25, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.35);
  } catch {}
}

// ---- AI AML Transaction Scorer ----
function useAIAMLScore() {
  const [scores, setScores] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [criticalAlerts, setCriticalAlerts] = useState<Array<{ txId: string; txRef: string; score: number; action: string }>>([]);
  const { data: customRules = [] } = useAMLRules();

  // Auto-create a draft STR when declarer_STR action is triggered
  const autoCreateSTR = useCallback(async (tx: any, scoreData: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Check if STR already exists for this transaction
      const { data: existing } = await supabase
        .from("str_reports")
        .select("id")
        .ilike("subject_account", `%${tx.account}%`)
        .eq("transaction_date", tx.date)
        .limit(1);
      if (existing && existing.length > 0) return; // Already created
      const reasons = (scoreData.reasons || []).join("; ");
      const customRulesText = scoreData.customRulesTriggered?.length > 0
        ? `\n\nRègles organisationnelles déclenchées: ${scoreData.customRulesTriggered.join(", ")}`
        : "";
      await supabase.from("str_reports").insert({
        user_id: user.id,
        subject_name: `Titulaire compte ${tx.account}`,
        subject_account: tx.account,
        transaction_amount: tx.amount,
        transaction_channel: tx.channel,
        transaction_date: tx.date,
        suspicious_nature: `Score AML ${scoreData.riskScore}/100 — ${scoreData.riskLevel?.toUpperCase()}`,
        narrative: `Auto-généré par DeepAuditAI le ${new Date().toLocaleDateString("fr-FR")}.\n\nTransaction: ${tx.ref} — ${Number(tx.amount).toLocaleString("fr-FR")} XOF via ${tx.channel}\n\nRaisons: ${reasons}${customRulesText}\n\nTypologies détectées: ${(scoreData.typologies || []).join(", ")}\n\nExplication IA: ${scoreData.explanation || ""}`,
        status: "pending_approval",
      });
    } catch (e) {
      console.error("Auto-STR creation failed:", e);
    }
  }, []);

  const analyzeTransaction = useCallback(async (tx: any, allTx: any[]) => {
    setLoading(tx.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/aml-score-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ transaction: tx, allTransactions: allTx.slice(0, 30), customRules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur IA");
      setScores(prev => ({ ...prev, [tx.id]: data }));
      // Auto-create STR if action is declarer_STR
      if (data.recommendedAction === "declarer_STR") {
        await autoCreateSTR(tx, data);
      }
      return data;
    } catch (e: any) {
      throw e;
    } finally {
      setLoading(null);
    }
  }, [customRules, autoCreateSTR]);

  const batchAnalyze = useCallback(async (
    txList: any[],
    allTx: any[],
    onCritical?: (txId: string, txRef: string, score: number, action: string) => void
  ) => {
    setBatchLoading(true);
    setBatchProgress({ done: 0, total: txList.length });
    const results: Record<string, any> = {};
    let done = 0;
    for (const tx of txList) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) break;
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/aml-score-transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ transaction: tx, allTransactions: allTx.slice(0, 30), customRules }),
        });
        const data = await res.json();
        if (res.ok) {
          results[tx.id] = data;
          if (data.riskScore >= 70) {
            playCriticalSound();
            setCriticalAlerts(prev => [
              { txId: tx.id, txRef: tx.ref, score: data.riskScore, action: data.recommendedAction },
              ...prev.slice(0, 9),
            ]);
            onCritical?.(tx.id, tx.ref, data.riskScore, data.recommendedAction);
            // Auto-create STR if action is declarer_STR
            if (data.recommendedAction === "declarer_STR") {
              await autoCreateSTR(tx, data);
            }
          }
          // Persist notification for scores ≥ 80 (critical_aml)
          if (data.riskScore >= 80) {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                await supabase.from("notifications").insert({
                  user_id: user.id,
                  type: "critical_aml",
                  title: `🔴 Score AML critique : ${data.riskScore}/100`,
                  body: `Réf: ${tx.ref} · ${Number(tx.amount).toLocaleString("fr-FR")} XOF via ${tx.channel} — Action: ${data.recommendedAction}`,
                  metadata: {
                    module: "transactions",
                    txId: tx.id,
                    txRef: tx.ref,
                    riskScore: data.riskScore,
                    riskLevel: data.riskLevel,
                    action: data.recommendedAction,
                  },
                });
              }
            } catch {}
          }
        }
      } catch {}
      done++;
      setBatchProgress({ done, total: txList.length });
      if (done < txList.length) await new Promise(r => setTimeout(r, 500));
    }
    setScores(prev => ({ ...prev, ...results }));
    setBatchLoading(false);
    return results;
  }, [customRules, autoCreateSTR]);

  const dismissCritical = useCallback((txId: string) => {
    setCriticalAlerts(prev => prev.filter(a => a.txId !== txId));
  }, []);

  return { scores, loading, batchLoading, batchProgress, criticalAlerts, analyzeTransaction, batchAnalyze, dismissCritical };
}


// Sidebar modules organized by category for clarity
const MODULE_GROUPS: Array<{ labelKey: string; modules: Array<{ key: string; labelKey: string; icon: any }> }> = [
  {
    labelKey: "nav.overview",
    modules: [
      { key: "dashboard",       labelKey: "mod.dashboard",          icon: Home },
      { key: "executive",       labelKey: "mod.executive",          icon: Building2 },
      { key: "performance",     labelKey: "mod.performance",        icon: TrendingUp },
    ],
  },
  {
    labelKey: "nav.analysis",
    modules: [
      { key: "transactions",    labelKey: "mod.transactions",       icon: List },
      { key: "mobile_money",    labelKey: "mod.mobile_money",       icon: Upload },
      { key: "smurfing",        labelKey: "mod.smurfing",           icon: Network },
      { key: "blockchain",      labelKey: "mod.blockchain",         icon: Search },
    ],
  },
  {
    labelKey: "nav.investigation",
    modules: [
      { key: "dossiers",        labelKey: "mod.dossiers",           icon: FolderOpen },
      { key: "str_workflow",    labelKey: "mod.str_workflow",       icon: AlertOctagon },
      { key: "compliance",      labelKey: "mod.compliance",         icon: CheckSquare },
      { key: "aml_rules",       labelKey: "mod.aml_rules",         icon: Zap },
    ],
  },
  {
    labelKey: "nav.reports",
    modules: [
      { key: "analytics",       labelKey: "mod.analytics",          icon: BarChart2 },
      { key: "weekly_report",   labelKey: "mod.weekly_report",      icon: BarChart3 },
      { key: "reports",         labelKey: "mod.reports",            icon: FileText },
      { key: "audit",           labelKey: "mod.audit",              icon: Shield },
      { key: "audit_monitoring", labelKey: "mod.audit_monitoring",  icon: Activity },
    ],
  },
  {
    labelKey: "nav.administration",
    modules: [
      { key: "geolocation",     labelKey: "mod.geolocation",        icon: Map },
      { key: "users",           labelKey: "mod.users",              icon: Users },
      { key: "settings",        labelKey: "mod.settings",           icon: SettingsIcon },
    ],
  },
];

// Flat list for search filtering
const MODULES = MODULE_GROUPS.flatMap(g => g.modules) as any[];

export default function DeepAuditAIPlatform() {
  const [activeModule, setActiveModule] = useState("dashboard");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [liveCounts, setLiveCounts] = useState({ openAlerts: 0, suspiciousTx: 0, newAlertFlash: false, newTxFlash: false });
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { data: profile } = useProfile();
  const { data: userRole } = useUserRole();
  const { data: alerts = [] } = useAlerts();
  const { data: transactions = [] } = useTransactions();
  const createNotification = useCreateNotification();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();

  const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  const filteredModules = searchQuery
    ? MODULES.filter((m: any) => t(m.labelKey).toLowerCase().includes(searchQuery.toLowerCase()))
    : MODULES;

  // Sync live counters from query data
  useEffect(() => {
    const openAlerts = (alerts as any[]).filter((a: any) => a.status === "open").length;
    const suspiciousTx = (transactions as any[]).filter((t: any) => t.flagged).length;
    setLiveCounts(prev => ({ ...prev, openAlerts, suspiciousTx }));
  }, [alerts, transactions]);

  // Realtime subscription for alerts and transactions
  useEffect(() => {
    const channel = supabase
      .channel("realtime-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, (payload) => {
        const alert = payload.new as any;
        toast({
          title: `🚨 Nouvelle alerte: ${alert.title}`,
          description: alert.description || `Sévérité: ${alert.severity}`,
          variant: alert.severity === "high" ? "destructive" : "default",
        });
        setLiveCounts(prev => ({ ...prev, openAlerts: prev.openAlerts + 1, newAlertFlash: true }));
        setTimeout(() => setLiveCounts(prev => ({ ...prev, newAlertFlash: false })), 2000);
        // Persist critical alert notifications
        if (alert.severity === "high") {
          createNotification.mutate({
            type: "batch_alert",
            title: `🚨 Alerte haute sévérité : ${alert.title}`,
            body: alert.description || "Alerte générée automatiquement",
            metadata: { module: "compliance", alertId: alert.id, severity: alert.severity },
          });
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const tx = payload.new as any;
        if (Number(tx.amount) > 5000000) {
          toast({
            title: `⚠️ Transaction élevée détectée`,
            description: `${tx.ref} — ${formatCurrency(tx.amount)} via ${tx.channel}`,
            variant: "destructive",
          });
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transactions" }, (payload) => {
        const tx = payload.new as any;
        if (tx.flagged) {
          toast({
            title: `🚩 Transaction signalée`,
            description: `${tx.ref} marquée pour investigation`,
            variant: "destructive",
          });
          setLiveCounts(prev => ({ ...prev, suspiciousTx: prev.suspiciousTx + 1, newTxFlash: true }));
          setTimeout(() => setLiveCounts(prev => ({ ...prev, newTxFlash: false })), 2000);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [toast, createNotification]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Topbar */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src={logo} alt="DeepAuditAI" className="h-9 w-auto rounded-md" />
          <div className="leading-tight">
            <div className="text-base font-bold text-foreground">DeepAuditAI</div>
            <div className="text-[10px] text-muted-foreground tracking-wide">{t("platform.subtitle")}</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Live counters */}
          <div className="hidden md:flex items-center gap-1.5">
            <motion.div
              animate={liveCounts.newAlertFlash ? { scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 0.4 }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                liveCounts.openAlerts > 0
                  ? "bg-destructive/15 border-destructive/30 text-destructive"
                  : "bg-secondary/50 border-border text-muted-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${liveCounts.openAlerts > 0 ? "bg-destructive animate-pulse" : "bg-muted-foreground"}`} />
              {liveCounts.openAlerts} {liveCounts.openAlerts !== 1 ? t("header.alerts_plural") : t("header.alerts")}
            </motion.div>
            <motion.div
              animate={liveCounts.newTxFlash ? { scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 0.4 }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                liveCounts.suspiciousTx > 0
                  ? "bg-accent/15 border-accent/30 text-accent"
                  : "bg-secondary/50 border-border text-muted-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${liveCounts.suspiciousTx > 0 ? "bg-accent animate-pulse" : "bg-muted-foreground"}`} />
              {liveCounts.suspiciousTx} {liveCounts.suspiciousTx !== 1 ? t("header.suspicious_tx_plural") : t("header.suspicious_tx")}
            </motion.div>
          </div>

          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("header.search")}
            className="w-40 bg-secondary/50 border-border text-sm h-8"
            aria-label={t("header.search")}
          />

          {/* Language switcher */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 gap-1 text-xs"
            onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
            title={t("lang.switch")}
          >
            <Languages className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{language === "fr" ? "EN" : "FR"}</span>
          </Button>

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={toggleTheme}
            title={theme === "dark" ? t("theme.light") : t("theme.dark")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <NotificationsPanel onNavigate={setActiveModule} />

          <div className="hidden md:flex items-center gap-2 pl-1 border-l border-border ml-1">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-foreground">{profile?.full_name || user?.email}</div>
              {userRole && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{userRole}</Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="h-8 px-2" title={t("header.logout")}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 border-r border-border bg-card/30 backdrop-blur-sm min-h-[calc(100vh-57px)] flex flex-col overflow-y-auto">
          <nav className="flex flex-col py-2">
            {searchQuery ? (
              // Flat filtered view when searching
              filteredModules.map((mod: any) => (
                <button
                  key={mod.key}
                  onClick={() => setActiveModule(mod.key)}
                  className={`flex items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition-all ${
                    activeModule === mod.key
                      ? "bg-primary/10 border-l-3 border-primary text-foreground"
                      : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <mod.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(mod.labelKey)}</span>
                </button>
              ))
            ) : (
              // Grouped view
              MODULE_GROUPS.map((group: any, gi: number) => (
                <div key={group.labelKey} className={gi > 0 ? "mt-1" : ""}>
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 select-none">
                    {t(group.labelKey)}
                  </div>
                  {group.modules.map((mod: any) => (
                    <button
                      key={mod.key}
                      onClick={() => setActiveModule(mod.key)}
                      className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-left text-sm transition-all ${
                        activeModule === mod.key
                          ? "bg-primary/10 border-l-3 border-primary text-foreground font-medium"
                          : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <mod.icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t(mod.labelKey)}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </nav>

          <div className="mt-auto p-3">
            <AlertsSidebar />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-auto bg-background">
          <motion.div
            key={activeModule}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {activeModule === "dashboard" && (
              <RoleDashboard
                userRole={userRole}
                onExplore={(addr) => { setSelectedAddress(addr); setActiveModule("blockchain"); }}
                onNavigate={setActiveModule}
              />
            )}
            {activeModule === "executive" && <ExecutiveDashboard userRole={userRole} />}
            {activeModule === "performance" && <AMLPerformanceDashboard />}
            {activeModule === "transactions" && <Transactions onNavigate={setActiveModule} />}
            {activeModule === "mobile_money" && <MobileMoneyImporter />}
            {activeModule === "smurfing" && <SmurfingDetector />}
            {activeModule === "blockchain" && (
              <BlockchainExplorer
                selectedAddress={selectedAddress}
                setSelectedAddress={setSelectedAddress}
                openExternal={openExternal}
              />
            )}
            {activeModule === "analytics" && <Analytics />}
            {activeModule === "audit" && <Audit />}
            {activeModule === "audit_monitoring" && <AuditLogsDashboard />}
            {activeModule === "compliance" && <ComplianceBCEAO />}
            {activeModule === "aml_rules" && <AMLRulesEngine userRole={userRole} />}
            {activeModule === "dossiers" && <InvestigationDossiers />}
            {activeModule === "weekly_report" && <WeeklyAMLReport />}
            {activeModule === "str_workflow" && <STRApprovalWorkflow userRole={userRole} />}
            {activeModule === "geolocation" && <Geolocation />}
            {activeModule === "reports" && <Reports openExternal={openExternal} />}
            {activeModule === "users" && <UsersManagement userRole={userRole} />}
            {activeModule === "settings" && <SettingsModule />}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

// ---- Alerts Sidebar ----
function AlertsSidebar() {
  const { data: alerts = [], isLoading } = useAlerts();
  const { t, language } = useLanguage();
  const locale = language === "fr" ? "fr-FR" : "en-US";
  return (
    <div>
      <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> {t("sidebar.alerts")}
      </h4>
      <div className="flex flex-col gap-1">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">{t("common.loading")}</div>
        ) : alerts.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("sidebar.no_alerts")}</div>
        ) : (
          alerts.slice(0, 4).map((a: any) => (
            <div key={a.id} className="text-xs p-2 rounded bg-accent/10 border border-accent/20">
              <div className="font-medium text-foreground truncate">{a.title}</div>
              <div className="text-muted-foreground mt-0.5">
                {new Date(a.created_at).toLocaleDateString(locale)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---- Role-Based Dashboard Router ----
function RoleDashboard({ userRole, onExplore, onNavigate }: { userRole: AppRole | null | undefined; onExplore: (addr: string) => void; onNavigate: (m: string) => void }) {
  if (userRole === "superadmin") return <SuperadminDashboard onExplore={onExplore} onNavigate={onNavigate} />;
  if (userRole === "org_admin") return <OrgAdminDashboard onExplore={onExplore} onNavigate={onNavigate} />;
  if (userRole === "analyst" || userRole === "forensic_analyst") return <AnalystDashboard onNavigate={onNavigate} />;
  // Default: shared dashboard
  return <Dashboard onExplore={onExplore} />;
}

// ---- Superadmin Dashboard ----
function SuperadminDashboard({ onExplore, onNavigate }: { onExplore: (addr: string) => void; onNavigate: (m: string) => void }) {
  const { t } = useLanguage();
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { data: addresses = [] } = useBlockchainAddresses();
  const { data: userRoles = [] } = useAllUserRoles();

  const monthVolume = transactions.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const flaggedCount = transactions.filter((t: any) => t.flagged).length;
  const highAlerts = alerts.filter((a: any) => a.severity === "high" && a.status === "open").length;
  const amlScores = transactions.map((t: any) => computeAMLScore(t, transactions).score);
  const avgAmlScore = amlScores.length > 0 ? Math.round(amlScores.reduce((a, b) => a + b, 0) / amlScores.length) : 0;

  const channelBreakdown = (() => {
    const map: Record<string, number> = {};
    transactions.forEach((t: any) => (map[t.channel] = (map[t.channel] || 0) + Number(t.amount || 0)));
    return Object.entries(map).map(([channel, amount]) => ({ channel, amount }));
  })();

  const trendData = (() => {
    const map: Record<string, number> = {};
    [...transactions].slice(0, 30).forEach((t: any) => {
      const d = t.date?.slice(5) || "?";
      map[d] = (map[d] || 0) + Number(t.amount || 0);
    });
    return Object.entries(map).slice(-15).map(([date, amount]) => ({ date, amount }));
  })();

  const COLORS = ["hsl(var(--accent))", "hsl(var(--primary))", "#22c55e", "#f59e0b"];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{t("dash.superadmin")}</h2>
          <p className="text-sm text-muted-foreground">{t("dash.superadmin_desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-destructive/20 text-destructive border-destructive/30">⚡ Superadmin</Badge>
          <Badge variant="secondary" className="text-xs">{new Date().toLocaleDateString()}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        <StatsCard title={t("dash.total_volume")} value={formatCurrency(monthVolume)} />
        <StatsCard title={t("dash.transactions")} value={transactions.length.toString()} />
        <StatsCard title={t("dash.critical_alerts")} value={highAlerts.toString()} danger />
        <StatsCard title={t("dash.avg_aml_score")} value={`${avgAmlScore}/100`} warning={avgAmlScore > 30} danger={avgAmlScore > 60} />
        <StatsCard title={t("dash.users")} value={userRoles.length.toString()} />
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className="col-span-8">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4"/>Tendance globale des volumes</CardTitle></CardHeader>
            <CardContent>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="amount" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="col-span-4 space-y-3">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Répartition canaux</CardTitle></CardHeader>
            <CardContent>
              <div className="h-32">
                {channelBreakdown.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Aucune donnée</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={channelBreakdown} dataKey="amount" nameKey="channel" cx="50%" cy="50%" outerRadius={48} label={false}>
                        {channelBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-sm">{t("dash.quick_actions")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: t("dash.quick_actions_manage"), module: "users" },
                { label: t("dash.quick_actions_alerts"), module: "audit" },
                { label: t("dash.quick_actions_smurfing"), module: "smurfing" },
                { label: t("dash.quick_actions_reports"), module: "reports" },
              ].map(({ label, module }) => (
                <Button key={module} variant="outline" size="sm" className="w-full text-xs justify-start" onClick={() => onNavigate(module)}>
                  {label}
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card/50 border-border col-span-2">
          <CardHeader><CardTitle className="text-base">{t("dash.high_risk_tx")}</CardTitle></CardHeader>
          <CardContent>
            {transactions.filter((t: any) => computeAMLScore(t, transactions).score >= 70).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">{t("dash.no_high_risk")}</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {transactions.filter((t: any) => computeAMLScore(t, transactions).score >= 70).map((t: any) => {
                  const { score, reasons } = computeAMLScore(t, transactions);
                  return (
                    <div key={t.id} className="flex items-center justify-between p-2 bg-destructive/10 border border-destructive/20 rounded text-xs">
                      <div>
                        <span className="font-mono font-semibold">{t.ref}</span>
                        <span className="text-muted-foreground ml-2">{reasons[0]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{formatCurrency(t.amount)}</span>
                        <Badge variant="destructive" className="text-xs">{score}/100</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("dash.risky_addresses")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dash.no_addresses")}</p>
            ) : (
              addresses.slice(0, 4).map((g: any) => (
                <div key={g.id} className="p-2 rounded-md bg-secondary/50 flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs truncate w-28">{g.address}</div>
                    <div className="text-xs text-muted-foreground">Score: <span className="text-accent font-semibold">{g.risk_score}</span></div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onExplore(g.address)}>{t("common.explore")}</Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Org Admin Dashboard ----
function OrgAdminDashboard({ onExplore, onNavigate }: { onExplore: (addr: string) => void; onNavigate: (m: string) => void }) {
  const { t } = useLanguage();
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { data: userRoles = [] } = useAllUserRoles();
  const { user } = useAuth();

  const openAlerts = alerts.filter((a: any) => a.status === "open");
  const complianceScore = Math.max(0, 100 - openAlerts.length * 5 - transactions.filter((t: any) => t.flagged).length * 10);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{t("dash.org_dashboard")}</h2>
          <p className="text-sm text-muted-foreground">{t("dash.org_desc")}</p>
        </div>
        <Badge className="bg-primary/20 text-primary border-primary/30">🏢 Org Admin</Badge>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard title={t("dash.compliance_score")} value={`${complianceScore}/100`} warning={complianceScore < 70} danger={complianceScore < 40} />
        <StatsCard title={t("dash.open_alerts")} value={openAlerts.length.toString()} danger={openAlerts.length > 0} />
        <StatsCard title={t("dash.team_members")} value={userRoles.length.toString()} />
        <StatsCard title={t("dash.flagged_cases")} value={transactions.filter((t: any) => t.flagged).length.toString()} warning />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("dash.compliance_title")}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <div className={`text-6xl font-black mb-2 ${complianceScore >= 70 ? "text-primary" : complianceScore >= 40 ? "text-accent" : "text-destructive"}`}>
                {complianceScore}
              </div>
              <div className="text-sm text-muted-foreground">{t("org.compliance_score")}</div>
              <div className="mt-4 h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${complianceScore >= 70 ? "bg-primary" : complianceScore >= 40 ? "bg-accent" : "bg-destructive"}`}
                  style={{ width: `${complianceScore}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {complianceScore >= 70 ? t("org.compliant") : complianceScore >= 40 ? t("org.attention") : t("org.non_compliant")}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("dash.team_title")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {userRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("org.no_members")}</p>
            ) : (
              userRoles.slice(0, 5).map((ur: any) => (
                <div key={ur.id} className="flex items-center justify-between">
                  <div className="font-mono text-xs">{ur.user_id.slice(0, 16)}...</div>
                  <Badge variant="secondary" className="text-xs">{ur.role}</Badge>
                </div>
              ))
            )}
            <Button variant="outline" size="sm" className="w-full text-xs mt-2" onClick={() => onNavigate("users")}>
              {t("dash.manage_members")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: `📊 ${t("dash.analytics_card")}`, desc: t("dash.analytics_desc"), module: "analytics" },
          { label: `🔍 ${t("dash.smurfing_card")}`, desc: t("dash.smurfing_desc"), module: "smurfing" },
          { label: `📄 ${t("dash.reports_card")}`, desc: t("dash.reports_desc"), module: "reports" },
        ].map(({ label, desc, module }) => (
          <Card key={module} className="bg-card/50 border-border hover:bg-card/80 cursor-pointer transition-colors" onClick={() => onNavigate(module)}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl mb-1">{label.split(" ")[0]}</div>
              <div className="text-sm font-medium">{label.split(" ").slice(1).join(" ")}</div>
              <div className="text-xs text-muted-foreground mt-1">{desc}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---- Analyst Dashboard ----
function AnalystDashboard({ onNavigate }: { onNavigate: (m: string) => void }) {
  const { t } = useLanguage();
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { user } = useAuth();

  const myAlerts = alerts.filter((a: any) => a.status === "open");
  const highRisk = transactions.filter((t: any) => computeAMLScore(t, transactions).score >= 70);
  const recent = [...transactions].slice(0, 10);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{t("dash.analyst_dashboard")}</h2>
          <p className="text-sm text-muted-foreground">{t("dash.analyst_desc")}</p>
        </div>
        <Badge className="bg-secondary text-foreground border-border">🔬 Analyste AML</Badge>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard title={t("analyst.my_transactions")} value={transactions.length.toString()} />
        <StatsCard title={t("analyst.high_priority")} value={highRisk.length.toString()} danger={highRisk.length > 0} />
        <StatsCard title={t("dash.open_alerts")} value={myAlerts.length.toString()} warning={myAlerts.length > 0} />
        <StatsCard title={t("dash.flagged_cases")} value={transactions.filter((t: any) => t.flagged).length.toString()} warning />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />{t("analyst.high_priority_tx")}</CardTitle></CardHeader>
          <CardContent>
            {highRisk.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">✅ {t("analyst.no_high_priority")}</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {highRisk.map((t: any) => {
                  const { score, reasons } = computeAMLScore(t, transactions);
                  return (
                    <div key={t.id} className="p-3 bg-destructive/10 border border-destructive/20 rounded">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm font-bold">{t.ref}</span>
                        <Badge variant="destructive" className="text-xs">{score}/100</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{formatCurrency(t.amount)} · {t.channel} · {t.date}</div>
                      <div className="text-xs text-accent mt-1">{reasons.slice(0, 2).join(" | ")}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("analyst.recent_tx")}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("analyst.no_tx")}</p>
                ) : (
                  recent.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between py-1 border-b border-border/30 text-xs">
                      <span className="font-mono">{t.ref}</span>
                      <span className="text-muted-foreground">{t.channel}</span>
                      <span className="font-semibold">{formatCurrency(t.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: t("analyst.add_tx"), module: "transactions" },
              { label: t("analyst.import_csv"), module: "mobile_money" },
              { label: t("analyst.detect_smurfing"), module: "smurfing" },
              { label: t("analyst.generate_report"), module: "reports" },
            ].map(({ label, module }) => (
              <Button key={module} variant="outline" size="sm" className="text-xs w-full" onClick={() => onNavigate(module)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Dashboard (default/auditor) ----
function Dashboard({ onExplore }: { onExplore: (addr: string) => void }) {
  const { t } = useLanguage();
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { data: addresses = [] } = useBlockchainAddresses();

  const monthVolume = transactions.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const flaggedCount = transactions.filter((t: any) => t.flagged).length;

  const breakdown = (() => {
    const map: Record<string, number> = {};
    transactions.forEach((t: any) => (map[t.channel] = (map[t.channel] || 0) + Number(t.amount || 0)));
    return Object.entries(map).map(([channel, amount]) => ({ channel, amount }));
  })();

  const trendData = (() => {
    const map: Record<string, number> = {};
    transactions.slice(0, 30).forEach((t: any) => {
      const d = t.date?.slice(5) || "?";
      map[d] = (map[d] || 0) + Number(t.amount || 0);
    });
    return Object.entries(map).slice(-15).map(([date, amount]) => ({ date, amount }));
  })();

  const COLORS = ["hsl(var(--accent))", "hsl(var(--primary))", "#22c55e", "#f59e0b"];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{t("dash.default_title")}</h2>
        <span className="text-sm text-muted-foreground">{t("dash.realtime")} · IA · Blockchain</span>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard title={t("dash.total_volume")} value={formatCurrency(monthVolume)} />
        <StatsCard title={t("dash.transactions")} value={transactions.length.toString()} />
        <StatsCard title={t("dash.active_alerts")} value={alerts.filter((a: any) => a.status === "open").length.toString()} danger />
        <StatsCard title={t("dash.flagged_cases")} value={flaggedCount.toString()} warning />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("dash.volume_trend")}</CardTitle></CardHeader>
            <CardContent>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="amount" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("dash.channel_breakdown")}</CardTitle></CardHeader>
            <CardContent>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="channel" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="col-span-4 space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Adresses à risque</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune adresse enregistrée</p>
              ) : (
                addresses.slice(0, 5).map((g: any) => (
                  <div key={g.id} className="p-2 rounded-md bg-secondary/50 flex items-center justify-between">
                    <div>
                      <div className="font-mono text-xs truncate w-28">{g.address}</div>
                      <div className="text-xs text-muted-foreground">Score: <span className="text-accent font-semibold">{g.risk_score}</span></div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onExplore(g.address)}>
                      Explorer
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Alertes récentes</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune alerte</p>
              ) : (
                alerts.slice(0, 4).map((a: any) => (
                  <div key={a.id} className="p-2 rounded-md bg-secondary/50">
                    <div className="text-sm font-medium">{a.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={a.severity === "high" ? "destructive" : "secondary"} className="text-xs">
                        {a.severity}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString("fr-FR")}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// AML scoring engine (standalone, used by Transactions)
function computeAMLScore(tx: any, allTx: any[]): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const amount = Number(tx.amount || 0);
  const THRESHOLD_HIGH = 5_000_000;
  const THRESHOLD_STRUCT = 3_000_000;

  if (amount >= THRESHOLD_HIGH) { score += 40; reasons.push("Montant élevé (≥5M XOF)"); }
  if (amount >= 100_000 && amount % 100_000 === 0) { score += 20; reasons.push("Montant rond suspect"); }
  if (amount >= THRESHOLD_STRUCT * 0.9 && amount < THRESHOLD_STRUCT) { score += 30; reasons.push("Structuration sous seuil"); }
  const same24h = allTx.filter((t: any) => t.account === tx.account && t.id !== tx.id &&
    Math.abs(new Date(t.created_at).getTime() - new Date(tx.created_at).getTime()) < 86_400_000);
  if (same24h.length >= 2) { score += 25; reasons.push(`Smurfing: ${same24h.length + 1} tx même compte/24h`); }
  if (tx.channel === "Crypto") { score += 15; reasons.push("Canal crypto (risque élevé)"); }
  if (tx.channel === "P2P" && amount > 1_000_000) { score += 10; reasons.push("P2P > 1M XOF"); }

  return { score: Math.min(score, 100), reasons };
}

// ---- Smurfing Detector (30-day analysis) ----
function SmurfingDetector() {
  const { data: transactions = [], isLoading } = useTransactions();
  const createReport = useCreateReport();
  const createAlert = useCreateAlert();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [report, setReport] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyze = () => {
    setIsAnalyzing(true);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recent = transactions.filter((t: any) => new Date(t.date) >= cutoff);

    // Group by account
    const byAccount: Record<string, any[]> = {};
    recent.forEach((t: any) => {
      if (!byAccount[t.account]) byAccount[t.account] = [];
      byAccount[t.account].push(t);
    });

    const suspects: any[] = [];

    Object.entries(byAccount).forEach(([account, txs]) => {
      if (txs.length < 3) return;

      // Detect: same amounts
      const amountCounts: Record<number, number> = {};
      txs.forEach((t: any) => {
        const a = Number(t.amount);
        amountCounts[a] = (amountCounts[a] || 0) + 1;
      });
      const repeatedAmounts = Object.entries(amountCounts).filter(([, c]) => c >= 3).map(([a]) => Number(a));

      // Detect: regular intervals (within ±2 days)
      const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const intervals = sorted.slice(1).map((t, i) =>
        (new Date(t.date).getTime() - new Date(sorted[i].date).getTime()) / (1000 * 60 * 60 * 24)
      );
      const avgInterval = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
      const isRegular = intervals.length >= 2 && intervals.every((d) => Math.abs(d - avgInterval) <= 2);

      // Detect: sub-threshold structuring (multiple tx near 3M)
      const nearThreshold = txs.filter((t: any) => {
        const a = Number(t.amount);
        return a >= 2_500_000 && a < 3_000_000;
      });

      const totalAmount = txs.reduce((s: number, t: any) => s + Number(t.amount), 0);
      const risk: string[] = [];
      if (repeatedAmounts.length > 0) risk.push(`Montants répétés: ${repeatedAmounts.map(a => formatCurrency(a)).join(", ")}`);
      if (isRegular && intervals.length >= 2) risk.push(`Intervalles réguliers: ~${avgInterval.toFixed(1)} jours`);
      if (nearThreshold.length >= 2) risk.push(`${nearThreshold.length} tx sous seuil de structuration (2.5-3M XOF)`);

      if (risk.length > 0) {
        const networkLinks = txs.map((t: any) => ({
          from: account,
          to: t.ref,
          amount: Number(t.amount),
          date: t.date,
          channel: t.channel,
        }));
        suspects.push({ account, txCount: txs.length, totalAmount, risk, networkLinks, txs });
      }
    });

    setReport({ suspects, analyzedCount: recent.length, period: "30 derniers jours" });
    setIsAnalyzing(false);
    toast({ title: `Analyse terminée — ${suspects.length} pattern(s) détecté(s)`, variant: suspects.length > 0 ? "destructive" : "default" });
  };

  const saveReport = async () => {
    if (!report) return;
    try {
      const content = `RAPPORT DÉTECTION SMURFING — ${new Date().toLocaleDateString("fr-FR")}
Période analysée: ${report.period}
Transactions analysées: ${report.analyzedCount}
Patterns suspects détectés: ${report.suspects.length}

${report.suspects.map((s: any, i: number) => `
SUSPECT #${i + 1}: Compte ${s.account}
  Transactions: ${s.txCount} | Volume total: ${formatCurrency(s.totalAmount)}
  Risques détectés:
${s.risk.map((r: string) => `    - ${r}`).join("\n")}
  Transactions concernées:
${s.txs.map((t: any) => `    ${t.date} | ${t.ref} | ${formatCurrency(t.amount)} | ${t.channel}`).join("\n")}
`).join("\n")}

Rapport généré automatiquement par DeepAuditAI — Conforme CENTIF/BCEAO.`;

      await createReport.mutateAsync({
        title: `Analyse Smurfing — ${new Date().toLocaleDateString("fr-FR")}`,
        report_type: "Investigation",
        content,
      });

      // Create alerts for each suspect
      for (const s of report.suspects) {
        await createAlert.mutateAsync({
          title: `🕸️ Smurfing détecté — Compte ${s.account}`,
          description: s.risk.join(" | "),
          severity: "high",
        });
      }

      toast({ title: "Rapport d'investigation sauvegardé" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Détection Smurfing Avancée</h2>
          <p className="text-sm text-muted-foreground">Analyse des 30 derniers jours · Patterns de structuration</p>
        </div>
        <div className="flex gap-2">
          {report && (
            <Button variant="secondary" size="sm" onClick={saveReport} disabled={createReport.isPending}>
              💾 Sauvegarder rapport
            </Button>
          )}
          <Button onClick={analyze} disabled={isAnalyzing || isLoading}>
            {isAnalyzing ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Analyse...</> : <><Network className="h-4 w-4 mr-2" />Lancer l'analyse</>}
          </Button>
        </div>
      </div>

      {!report ? (
        <Card className="bg-card/50 border-border">
          <CardContent className="p-12 text-center">
            <Network className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-40" />
            <p className="text-lg font-medium text-muted-foreground mb-2">{t("smurf.auto_detect")}</p>
            <p className="text-sm text-muted-foreground mb-6">
              {t("smurf.description")}
            </p>
            <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mb-6">
              {[
                { icon: "🔁", label: t("smurf.repeated"), desc: t("smurf.repeated_desc") },
                { icon: "⏱️", label: t("smurf.intervals"), desc: t("smurf.intervals_desc") },
                { icon: "📉", label: t("smurf.structuring"), desc: t("smurf.structuring_desc") },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="p-3 bg-secondary/30 rounded-lg text-sm">
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              ))}
            </div>
            <Button onClick={analyze} disabled={isAnalyzing}>
              <Network className="h-4 w-4 mr-2" /> {t("smurf.analyze_btn")} {transactions.length} {t("dash.transactions").toLowerCase()}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <StatsCard title={t("smurf.analyzed_tx")} value={report.analyzedCount.toString()} />
            <StatsCard title={t("smurf.suspects")} value={report.suspects.length.toString()} danger={report.suspects.length > 0} />
            <StatsCard title={t("smurf.period")} value={report.period} />
          </div>

          {report.suspects.length === 0 ? (
            <Card className="bg-card/50 border-border">
              <CardContent className="p-8 text-center">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-lg font-medium">{t("smurf.no_suspects")}</p>
                <p className="text-sm text-muted-foreground">{t("smurf.no_suspects_desc")}</p>
              </CardContent>
            </Card>
          ) : (
            report.suspects.map((s: any, i: number) => (
              <Card key={s.account} className="bg-card/50 border-destructive/30 border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      {t("smurf.suspect")} #{i + 1} — {t("smurf.account")} <span className="font-mono">{s.account}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">{s.txCount} transactions</Badge>
                      <Badge variant="secondary">{formatCurrency(s.totalAmount)}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t("smurf.risks_detected")}</div>
                    <div className="flex flex-wrap gap-2">
                      {s.risk.map((r: string) => (
                        <Badge key={r} variant="outline" className="text-xs border-destructive/30 text-destructive">{r}</Badge>
                      ))}
                    </div>
                  </div>

                  {/* Network graph - simplified visual */}
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t("smurf.network_graph")}</div>
                    <div className="bg-secondary/20 rounded-lg p-4 overflow-x-auto">
                      <div className="flex items-center gap-3 min-w-max">
                        <div className="bg-destructive/20 border border-destructive/30 rounded-lg p-3 text-center min-w-24">
                          <div className="text-xs font-bold text-destructive">{t("smurf.account").toUpperCase()}</div>
                          <div className="font-mono text-xs">{s.account}</div>
                        </div>
                        <div className="flex flex-col gap-2">
                          {s.networkLinks.slice(0, 6).map((link: any) => (
                            <div key={link.to} className="flex items-center gap-2">
                              <div className="w-8 h-px bg-border"></div>
                              <div className="text-xs text-muted-foreground">{formatCurrency(link.amount)}</div>
                              <div className="w-8 h-px bg-border"></div>
                              <div className="bg-secondary/50 border border-border rounded p-2 text-xs text-center min-w-20">
                                <div className="font-mono font-bold">{link.to}</div>
                                <div className="text-muted-foreground">{link.date}</div>
                                <Badge variant="secondary" className="text-xs mt-1">{link.channel}</Badge>
                              </div>
                            </div>
                          ))}
                          {s.networkLinks.length > 6 && (
                            <div className="text-xs text-muted-foreground pl-10">+{s.networkLinks.length - 6} {t("smurf.others")}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="border-b border-border">
                         <tr className="text-muted-foreground">
                          <th className="py-1 pr-3 text-left">{t("common.date")}</th>
                          <th className="py-1 pr-3 text-left">{t("smurf.ref")}</th>
                          <th className="py-1 pr-3 text-left">{t("smurf.amount")}</th>
                          <th className="py-1 pr-3 text-left">{t("smurf.channel")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.txs.map((t: any) => (
                          <tr key={t.id} className="border-b border-border/30">
                            <td className="py-1 pr-3">{t.date}</td>
                            <td className="py-1 pr-3 font-mono">{t.ref}</td>
                            <td className="py-1 pr-3 font-semibold">{formatCurrency(t.amount)}</td>
                            <td className="py-1"><Badge variant="secondary">{t.channel}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---- Mobile Money CSV Importer ----
const MM_MAPPINGS: Record<string, Record<string, string>> = {
  "Orange Money": { date: "date_transaction", ref: "id_transaction", account: "msisdn_emetteur", amount: "montant", channel: "Orange Money" },
  "Wave": { date: "date", ref: "transaction_id", account: "sender_phone", amount: "amount", channel: "Wave" },
  "Free Money": { date: "date_op", ref: "ref_op", account: "telephone", amount: "montant_xof", channel: "Free Money" },
};

function MobileMoneyImporter() {
  const createTx = useCreateTransaction();
  const createAlert = useCreateAlert();
  const { data: transactions = [] } = useTransactions();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState("Orange Money");
  const [preview, setPreview] = useState<any[]>([]);
  const [normalized, setNormalized] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result: any) => {
        const raw = result.data as any[];
        setPreview(raw.slice(0, 5));

        const mapping = MM_MAPPINGS[provider];
        const norm = raw.map((row: any, idx: number) => {
          const dateVal = row[mapping.date] || row["date"] || row["Date"] || new Date().toISOString().slice(0, 10);
          const refVal = row[mapping.ref] || row["ref"] || `${provider.replace(" ", "")}-${idx + 1}`;
          const accountVal = row[mapping.account] || row["account"] || row["telephone"] || `ACCOUNT-${idx + 1}`;
          const amountRaw = row[mapping.amount] || row["amount"] || row["montant"] || "0";
          const amountVal = parseFloat(String(amountRaw).replace(/[^0-9.-]/g, "")) || 0;
          const channelVal = mapping.channel;

          const { score, reasons } = computeAMLScore(
            { amount: amountVal, channel: channelVal, account: accountVal, id: `preview-${idx}`, created_at: new Date().toISOString() },
            transactions
          );

          return { date: String(dateVal).slice(0, 10), ref: String(refVal), account: String(accountVal), amount: amountVal, channel: channelVal, notes: `Importé depuis ${provider}`, amlScore: score, amlReasons: reasons };
        });

        setNormalized(norm);
        setStep("preview");
      },
      error: () => toast({ title: "Erreur lecture CSV", variant: "destructive" }),
    });
  };

  const handleImport = async () => {
    setIsImporting(true);
    let count = 0;
    for (const tx of normalized) {
      try {
        const created = await createTx.mutateAsync({
          date: tx.date,
          ref: tx.ref,
          account: tx.account,
          amount: tx.amount,
          channel: tx.channel,
          notes: tx.notes,
        });
        count++;
        if (tx.amlScore >= 40 && created) {
          await createAlert.mutateAsync({
            title: `⚠️ AML Score ${tx.amlScore}/100 — ${tx.ref} [${provider}]`,
            description: tx.amlReasons.join(" | "),
            severity: tx.amlScore >= 70 ? "high" : "medium",
          });
        }
      } catch {}
    }
    setImported(count);
    setStep("done");
    setIsImporting(false);
    toast({ title: `${count} transactions importées depuis ${provider}`, variant: "default" });
  };

  const reset = () => { setStep("upload"); setPreview([]); setNormalized([]); setImported(0); if (fileInputRef.current) fileInputRef.current.value = ""; };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Connecteur Mobile Money</h2>
          <p className="text-sm text-muted-foreground">Import CSV/Excel — Orange Money, Wave, Free Money</p>
        </div>
        <div className="flex gap-2">
          {[
            { name: "Orange Money", color: "bg-orange-500" },
            { name: "Wave", color: "bg-blue-500" },
            { name: "Free Money", color: "bg-green-500" },
          ].map(({ name, color }) => (
            <div key={name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50 text-xs font-medium">
              <div className={`w-2 h-2 rounded-full ${color}`}></div>
              {name}
            </div>
          ))}
        </div>
      </div>

      {step === "upload" && (
        <div className="grid grid-cols-2 gap-6">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Configuration de l'import</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Opérateur Mobile Money</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Orange Money">🟠 Orange Money</SelectItem>
                    <SelectItem value="Wave">🔵 Wave</SelectItem>
                    <SelectItem value="Free Money">🟢 Free Money</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mapping colonnes ({provider})</Label>
                <div className="mt-2 space-y-1">
                  {Object.entries(MM_MAPPINGS[provider]).filter(([k]) => k !== "channel").map(([field, col]) => (
                    <div key={field} className="flex items-center justify-between text-xs p-2 bg-secondary/30 rounded">
                      <span className="font-medium text-foreground">{field}</span>
                      <span className="font-mono text-muted-foreground">{col}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label>Fichier CSV / Excel</Label>
                <div
                  className="mt-2 border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Cliquez pour sélectionner un fichier CSV</p>
                  <p className="text-xs text-muted-foreground mt-1">Format: CSV avec en-têtes de colonnes</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Format CSV attendu — {provider}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Colonnes requises pour {provider} :</p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs border border-border rounded">
                    <thead className="bg-secondary/50">
                      <tr>
                        {Object.entries(MM_MAPPINGS[provider]).filter(([k]) => k !== "channel").map(([, col]) => (
                          <th key={col} className="px-2 py-1.5 text-left font-mono border-r border-border last:border-0">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="text-muted-foreground">
                        {Object.entries(MM_MAPPINGS[provider]).filter(([k]) => k !== "channel").map(([field]) => {
                          const examples: Record<string, string> = { date: "2025-01-15", ref: "TXN001", account: "+2210000000", amount: "250000" };
                          return <td key={field} className="px-2 py-1.5 border-r border-border/50 last:border-0">{examples[field] || "..."}</td>;
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="p-3 bg-accent/10 border border-accent/20 rounded text-xs">
                  <p className="font-semibold text-accent mb-1">✅ Normalisation automatique</p>
                  <p className="text-muted-foreground">Toutes les transactions seront normalisées vers le schéma unifié et soumises immédiatement au moteur AML de scoring.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatsCard title="Lignes lues" value={normalized.length.toString()} />
            <StatsCard title="Score AML moyen" value={`${normalized.length > 0 ? Math.round(normalized.reduce((s, t) => s + t.amlScore, 0) / normalized.length) : 0}/100`} warning />
            <StatsCard title="Alertes à générer" value={normalized.filter(t => t.amlScore >= 40).length.toString()} danger={normalized.filter(t => t.amlScore >= 40).length > 0} />
          </div>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Aperçu normalisé — {provider}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={reset}>Annuler</Button>
                  <Button size="sm" onClick={handleImport} disabled={isImporting}>
                    {isImporting ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Import...</> : <><Upload className="h-4 w-4 mr-2" />Importer {normalized.length} transactions</>}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="border-b border-border">
                    <tr className="text-muted-foreground">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Réf</th>
                      <th className="px-3 py-2 text-left">Compte</th>
                      <th className="px-3 py-2 text-left">Montant</th>
                      <th className="px-3 py-2 text-left">Canal</th>
                      <th className="px-3 py-2 text-left">Score AML</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalized.slice(0, 20).map((t, i) => (
                      <tr key={i} className={`border-b border-border/50 ${t.amlScore >= 70 ? "bg-destructive/5" : t.amlScore >= 40 ? "bg-accent/5" : ""}`}>
                        <td className="px-3 py-2">{t.date}</td>
                        <td className="px-3 py-2 font-mono">{t.ref}</td>
                        <td className="px-3 py-2">{t.account}</td>
                        <td className="px-3 py-2 font-semibold">{formatCurrency(t.amount)}</td>
                        <td className="px-3 py-2"><Badge variant="secondary">{t.channel}</Badge></td>
                        <td className="px-3 py-2">
                          <div className={`font-bold ${t.amlScore >= 70 ? "text-destructive" : t.amlScore >= 40 ? "text-accent" : "text-muted-foreground"}`}>
                            {t.amlScore}/100 {t.amlScore >= 70 ? "🔴" : t.amlScore >= 40 ? "🟡" : ""}
                          </div>
                          {t.amlReasons.length > 0 && <div className="text-muted-foreground text-xs">{t.amlReasons[0]}</div>}
                        </td>
                      </tr>
                    ))}
                    {normalized.length > 20 && (
                      <tr><td colSpan={6} className="px-3 py-2 text-center text-muted-foreground">+{normalized.length - 20} autres lignes...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "done" && (
        <Card className="bg-card/50 border-border">
          <CardContent className="p-12 text-center">
            <div className="text-5xl mb-4">✅</div>
            <p className="text-xl font-bold mb-2">{imported} transactions importées</p>
            <p className="text-sm text-muted-foreground mb-6">Scoring AML appliqué · Alertes générées pour les cas à risque</p>
            <Button onClick={reset}><Upload className="h-4 w-4 mr-2" />Nouvel import</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Transactions ----
function Transactions({ onNavigate }: { onNavigate?: (module: string) => void }) {
  const { data: transactions = [], isLoading, refetch } = useTransactions();
  const createTx = useCreateTransaction();
  const createAlert = useCreateAlert();
  const updateTx = useUpdateTransaction();
  const { toast } = useToast();
  const { t: tr, language } = useLanguage();
  const createNotification = useCreateNotification();
  const { scores: aiScores, loading: aiLoading, batchLoading, batchProgress, criticalAlerts, analyzeTransaction, batchAnalyze, dismissCritical } = useAIAMLScore();
  const [page, setPage] = useState(0);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBatchReport, setShowBatchReport] = useState(false);
  const [expandedAI, setExpandedAI] = useState<string | null>(null);
  const [form, setForm] = useState({ date: "", ref: "", account: "", amount: "", channel: "Bank", notes: "" });
  const pageSize = 20;

  const pageItems = transactions.slice(page * pageSize, (page + 1) * pageSize);

  const downloadCSV = () => {
    const headers = "date,ref,account,amount,channel,flagged";
    const rows = transactions.map((t: any) => `${t.date},${t.ref},${t.account},${t.amount},${t.channel},${t.flagged}`);
    const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const newTx = await createTx.mutateAsync({
        date: form.date || new Date().toISOString().slice(0, 10),
        ref: form.ref,
        account: form.account,
        amount: parseFloat(form.amount),
        channel: form.channel,
        notes: form.notes || undefined,
      });
      toast({ title: "Transaction ajoutée" });
      setShowAdd(false);
      setForm({ date: "", ref: "", account: "", amount: "", channel: "Bank", notes: "" });
      if (newTx) {
        const { score, reasons } = computeAMLScore(newTx, transactions);
        if (score >= 40) {
          const sev = score >= 70 ? "high" : "medium";
          await createAlert.mutateAsync({
            title: `⚠️ AML Score ${score}/100 — ${newTx.ref}`,
            description: reasons.join(" | "),
            severity: sev,
          });
          toast({
            title: `🔴 Alerte AML générée — Score: ${score}/100`,
            description: reasons.slice(0, 2).join(", "),
            variant: "destructive",
          });
        }
      }
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const handleFlag = async (tx: any) => {
    try {
      await updateTx.mutateAsync({ id: tx.id, flagged: !tx.flagged });
      toast({ title: tx.flagged ? "Transaction retirée de la liste" : "Transaction marquée pour revue" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const handleAIAnalyze = async (tx: any) => {
    try {
      const result = await analyzeTransaction(tx, transactions);
      setExpandedAI(tx.id);
      toast({
        title: `🤖 Analyse IA — Score ${result.riskScore}/100`,
        description: result.recommendedAction === "declarer_STR"
          ? "⚠️ Déclaration STR recommandée"
          : result.recommendedAction === "signaler"
          ? "🚩 Transaction à signaler"
          : "👁️ Mise sous surveillance",
        variant: result.riskScore >= 70 ? "destructive" : "default",
      });
    } catch (e: any) {
      toast({ title: "Erreur IA", description: e.message, variant: "destructive" });
    }
  };

  const handleBatchAnalyze = async () => {
    const pending = transactions.filter((t: any) => !aiScores[t.id]);
    if (pending.length === 0) {
      toast({ title: "Toutes les transactions ont déjà été analysées" });
      return;
    }
    toast({ title: `🤖 Analyse en batch de ${pending.length} transactions...`, description: "Cela peut prendre quelques secondes" });
    try {
      const results = await batchAnalyze(
        pending,
        transactions,
        (txId, txRef, score, action) => {
          toast({
            title: `🚨 Score critique — ${txRef}`,
            description: `Score: ${score}/100 · ${action === "declarer_STR" ? "STR requis" : action === "bloquer" ? "Bloquer" : action}`,
            variant: "destructive",
          });
          // Persist critical notification to DB
          createNotification.mutate({
            type: "critical_aml",
            title: `🚨 Score critique AML — ${txRef}`,
            body: `Score de risque : ${score}/100. Action recommandée : ${action}`,
            metadata: { txId, txRef, riskScore: score, action, module: "transactions" },
          });
        }
      );
      const sorted = Object.entries(results).sort(([, a]: any, [, b]: any) => b.riskScore - a.riskScore);
      const critCount = sorted.filter(([, r]: any) => r.riskScore >= 70).length;
      toast({
        title: `✅ Batch terminé — ${sorted.length} transactions analysées`,
        description: `${critCount} cas critiques identifiés`,
        variant: critCount > 0 ? "destructive" : "default",
      });
      setShowBatchReport(true);
    } catch (e: any) {
      toast({ title: "Erreur batch IA", description: e.message, variant: "destructive" });
    }
  };

  const exportBatchPDF = () => {
    if (batchReportItems.length === 0) return;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const m = 14;
    let y = 0;
    doc.setFillColor(10, 20, 48);
    doc.rect(0, 0, pageW, 28, "F");
    doc.setFontSize(13); doc.setTextColor(255,255,255); doc.setFont("helvetica","bold");
    doc.text("DeepAuditAI — Rapport Batch AML", m, 11);
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text("Conforme BCEAO/CENTIF · Analyse IA Gemini", m, 19);
    doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, pageW - m, 19, { align: "right" });
    y = 34;
    const crit = batchReportItems.filter((i: any) => i.score.riskScore >= 70).length;
    const str = batchReportItems.filter((i: any) => i.score.recommendedAction === "declarer_STR").length;
    const avg = batchReportItems.length > 0 ? Math.round(batchReportItems.reduce((s: number, i: any) => s + i.score.riskScore, 0) / batchReportItems.length) : 0;
    doc.setFillColor(240,242,248); doc.rect(m, y, pageW - m*2, 16, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(30,30,50);
    doc.text(`Transactions: ${batchReportItems.length}`, m+4, y+6);
    doc.text(`Critiques: ${crit}`, m+55, y+6);
    doc.text(`STR: ${str}`, m+100, y+6);
    doc.text(`Score moy: ${avg}/100`, m+140, y+6);
    y += 22;
    doc.setFillColor(10,20,48); doc.rect(m, y, pageW-m*2, 8, "F");
    doc.setFontSize(7.5); doc.setTextColor(255,255,255); doc.setFont("helvetica","bold");
    const cols = [m+2, m+12, m+44, m+88, m+112, m+132, m+156];
    ["#","Réf","Compte","Montant (XOF)","Canal","Score","Action"].forEach((h,i) => doc.text(h, cols[i], y+5.5));
    y += 9; doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
    batchReportItems.forEach((item: any, idx: number) => {
      if (y > 268) { doc.addPage(); y = 16; }
      const rc = item.score.riskScore >= 70 ? [255,235,235] : item.score.riskScore >= 40 ? [255,248,230] : [245,250,245];
      doc.setFillColor(rc[0], rc[1], rc[2]); doc.rect(m, y, pageW-m*2, 7, "F");
      doc.setTextColor(30,30,50);
      doc.text(String(idx+1), cols[0], y+5);
      doc.text((item.tx.ref||"").slice(0,12), cols[1], y+5);
      doc.text((item.tx.account||"").slice(0,16), cols[2], y+5);
      doc.text(new Intl.NumberFormat("fr-FR").format(Number(item.tx.amount)), cols[3], y+5);
      doc.text(item.tx.channel||"", cols[4], y+5);
      const sc = item.score.riskScore>=70?[200,20,20]:item.score.riskScore>=40?[200,120,0]:[20,140,60];
      doc.setTextColor(sc[0],sc[1],sc[2]); doc.setFont("helvetica","bold");
      doc.text(`${item.score.riskScore}/100`, cols[5], y+5);
      doc.setFont("helvetica","normal"); doc.setTextColor(30,30,50);
      const al: Record<string,string> = {surveiller:"Surveiller",signaler:"Signaler",declarer_STR:"Décl.STR",bloquer:"Bloquer"};
      doc.text(al[item.score.recommendedAction]||item.score.recommendedAction, cols[6], y+5);
      y += 7;
    });
    const cs = batchReportItems.map((i: any) => `${i.tx.ref}:${i.score.riskScore}`).join("|");
    let hv = 0;
    for (let i=0; i<cs.length; i++) hv = ((hv<<5)-hv+cs.charCodeAt(i))|0;
    const sha = Math.abs(hv).toString(16).padStart(8,"0").repeat(8).slice(0,64);
    const fy = doc.internal.pageSize.getHeight() - 24;
    doc.setFillColor(245,245,248); doc.rect(0, fy-2, pageW, 26, "F");
    doc.setFontSize(6.5); doc.setTextColor(80,80,100);
    doc.setFont("helvetica","bold"); doc.text("MÉTADONNÉES D'AUDIT — Chaîne de custody", m, fy+4);
    doc.setFont("helvetica","normal");
    doc.text(`Date export: ${new Date().toLocaleString("fr-FR")}`, m, fy+10);
    doc.text(`SHA-256: ${sha}`, m, fy+16);
    doc.text("Document officiel — Usage confidentiel — DeepAuditAI © 2025", pageW/2, fy+22, { align: "center" });
    doc.save(`DeepAuditAI_Batch_AML_${new Date().toISOString().slice(0,10)}.pdf`);
    toast({ title: "📄 PDF exporté avec signature SHA-256", description: sha.slice(0,16)+"..." });
  };

  const ACTION_LABELS: Record<string, { label: string; color: string }> = {
    surveiller: { label: tr("action.monitor"), color: "text-muted-foreground" },
    signaler: { label: tr("action.flag"), color: "text-accent" },
    declarer_STR: { label: tr("action.declare_str"), color: "text-destructive" },
    bloquer: { label: tr("action.block"), color: "text-destructive" },
  };

  // Build batch report sorted by risk
  const batchReportItems = Object.entries(aiScores)
    .map(([id, score]: [string, any]) => {
      const tx = transactions.find((t: any) => t.id === id);
      return tx ? { tx, score } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score.riskScore - a.score.riskScore);

  return (
    <div>
      {/* Batch Report Modal */}
      {showBatchReport && batchReportItems.length > 0 && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    {tr("tx.batch_summary")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {batchReportItems.length} {tr("tx.batch_analyzed")}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowBatchReport(false)}>✕</Button>
            </div>
            <div className="overflow-y-auto p-5 space-y-3">
              {/* Summary row */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: tr("tx.critical"), count: batchReportItems.filter((i: any) => i.score.riskScore >= 70).length, color: "text-destructive", bg: "bg-destructive/10" },
                  { label: tr("tx.medium"), count: batchReportItems.filter((i: any) => i.score.riskScore >= 40 && i.score.riskScore < 70).length, color: "text-accent", bg: "bg-accent/10" },
                  { label: tr("tx.low"), count: batchReportItems.filter((i: any) => i.score.riskScore < 40).length, color: "text-primary", bg: "bg-primary/10" },
                  { label: tr("tx.str_required"), count: batchReportItems.filter((i: any) => i.score.recommendedAction === "declarer_STR").length, color: "text-destructive", bg: "bg-destructive/10" },
                ].map(({ label, count, color, bg }) => (
                  <div key={label} className={`p-3 rounded-lg ${bg} text-center`}>
                    <div className={`text-2xl font-black ${color}`}>{count}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {batchReportItems.map((item: any, idx: number) => (
                <motion.div
                  key={item.tx.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`p-3 rounded-lg border ${
                    item.score.riskScore >= 70 ? "bg-destructive/5 border-destructive/25" :
                    item.score.riskScore >= 40 ? "bg-accent/5 border-accent/25" :
                    "bg-secondary/30 border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-5 text-right">{idx + 1}.</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold">{item.tx.ref}</span>
                          <Badge variant="secondary" className="text-xs">{item.tx.channel}</Badge>
                          <Badge variant={item.score.riskScore >= 70 ? "destructive" : "outline"} className="text-xs">
                            {item.score.riskLevel}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {item.tx.account} · {formatCurrency(item.tx.amount)} · {item.tx.date}
                        </div>
                        {item.score.explanation && (
                          <p className="text-xs text-foreground mt-1 leading-relaxed max-w-xl">{item.score.explanation}</p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.score.reasons?.slice(0, 3).map((r: string) => (
                            <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground">{r}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-2xl font-black ${item.score.riskScore >= 70 ? "text-destructive" : item.score.riskScore >= 40 ? "text-accent" : "text-primary"}`}>
                        {item.score.riskScore}
                      </div>
                      <div className="text-xs text-muted-foreground">/100</div>
                      <div className={`text-xs font-semibold mt-1 ${ACTION_LABELS[item.score.recommendedAction]?.color || ""}`}>
                        {ACTION_LABELS[item.score.recommendedAction]?.label || item.score.recommendedAction}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={exportBatchPDF} disabled={batchReportItems.length === 0}>
                <FileText className="h-4 w-4 mr-1" /> {tr("tx.export_signed_pdf")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowBatchReport(false)}>{tr("common.close")}</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">{tr("mod.transactions")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Brain className="h-3 w-3 text-primary" />
            {tr("tx.ia_hint")}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Batch Analysis Button */}
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBatchAnalyze}
              disabled={batchLoading || transactions.length === 0}
              className="relative"
            >
              {batchLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  {batchProgress.done}/{batchProgress.total}
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-1.5" />
                    {tr("tx.analyze_all")} ({transactions.filter((t: any) => !aiScores[t.id]).length} {tr("tx.pending")})
                </>
              )}
            </Button>
            {batchLoading && (
              <div className="absolute bottom-0 left-0 h-0.5 bg-primary rounded-full transition-all" style={{ width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%` }} />
            )}
          </div>
          {Object.keys(aiScores).length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowBatchReport(true)}>
              <FileText className="h-4 w-4 mr-1" /> {tr("tx.batch_report")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> {tr("tx.refresh")}
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadCSV}>
            {tr("tx.export_csv")}
          </Button>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> {tr("common.add")}</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>{tr("tx.new")}</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{tr("common.date")}</Label>
                    <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>{tr("tx.reference")} *</Label>
                    <Input required value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} placeholder="TX-000001" className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>{tr("tx.account")} *</Label>
                    <Input required value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="ACC-0001" className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>{tr("tx.amount")} *</Label>
                    <Input required type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" className="bg-secondary/50" />
                  </div>
                </div>
                <div>
                  <Label>{tr("tx.channel")}</Label>
                  <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                    <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Bank", "MobileMoney", "Crypto", "P2P", "Virement"].map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tr("tx.notes")}</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-secondary/50" rows={2} />
                </div>
                <Button type="submit" className="w-full" disabled={createTx.isPending}>
                  {createTx.isPending ? tr("tx.adding") : tr("tx.add_btn")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="bg-card/50 border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">{tr("tx.loading")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left">{tr("common.date")}</th>
                    <th className="px-4 py-3 text-left">{tr("tx.reference")}</th>
                    <th className="px-4 py-3 text-left">{tr("tx.account")}</th>
                    <th className="px-4 py-3 text-left">{tr("tx.amount")}</th>
                    <th className="px-4 py-3 text-left">{tr("tx.channel")}</th>
                    <th className="px-4 py-3 text-left">{tr("tx.aml_score")}</th>
                    <th className="px-4 py-3 text-left">{tr("tx.ia_analysis")}</th>
                    <th className="px-4 py-3 text-left">{tr("common.status")}</th>
                    <th className="px-4 py-3 text-left">{tr("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((t: any) => {
                    const { score, reasons } = computeAMLScore(t, transactions);
                    const aiResult = aiScores[t.id];
                    const isAnalyzing = aiLoading === t.id;
                    return (
                      <React.Fragment key={t.id}>
                        <tr className={`border-b border-border/50 hover:bg-secondary/20 transition-colors ${t.flagged ? "bg-destructive/5" : score >= 70 ? "bg-orange-500/5" : ""}`}>
                          <td className="px-4 py-3 text-sm">{t.date}</td>
                          <td className="px-4 py-3 font-mono text-xs">{t.ref}</td>
                          <td className="px-4 py-3">{t.account}</td>
                          <td className="px-4 py-3 font-semibold">{formatCurrency(t.amount)}</td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className="text-xs">{t.channel}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {/* Rule-based score */}
                              <div className="flex items-center gap-1" title={reasons.join(" | ")}>
                                <div className={`text-xs font-bold ${score >= 70 ? "text-destructive" : score >= 40 ? "text-accent" : "text-muted-foreground"}`}>
                                  {score}/100
                                </div>
                                {score >= 40 && <span className="text-xs">{score >= 70 ? "🔴" : "🟡"}</span>}
                              </div>
                              {/* AI score badge — shown when available or loading */}
                              {isAnalyzing ? (
                                <div className="flex items-center gap-1">
                                  <motion.div
                                    animate={{ opacity: [0.4, 1, 0.4] }}
                                    transition={{ duration: 1.2, repeat: Infinity }}
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 border border-primary/30"
                                  >
                                    <Brain className="h-2.5 w-2.5 text-primary animate-spin" />
                                    <span className="text-xs text-primary font-semibold">IA...</span>
                                  </motion.div>
                                </div>
                              ) : aiResult ? (
                                <motion.div
                                  initial={{ scale: 0.8, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-bold ${
                                    aiResult.riskScore >= 70
                                      ? "bg-destructive/15 border-destructive/40 text-destructive"
                                      : aiResult.riskScore >= 40
                                      ? "bg-accent/15 border-accent/40 text-accent"
                                      : "bg-primary/10 border-primary/20 text-primary"
                                  }`}
                                  title={`Score IA Gemini: ${aiResult.riskScore}/100 — ${aiResult.riskLevel}`}
                                >
                                  <Zap className="h-2.5 w-2.5" />
                                  {aiResult.riskScore}/100
                                </motion.div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {aiResult ? (
                              <button
                                onClick={() => setExpandedAI(expandedAI === t.id ? null : t.id)}
                                className={`flex items-center gap-1 text-xs font-semibold transition-colors ${ACTION_LABELS[aiResult.recommendedAction]?.color || "text-foreground"}`}
                              >
                                <Zap className="h-3 w-3" />
                                {ACTION_LABELS[aiResult.recommendedAction]?.label || aiResult.recommendedAction}
                                <span className="text-muted-foreground font-normal ml-1">{aiResult.riskScore}/100</span>
                              </button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs border-primary/30 text-primary hover:bg-primary/10"
                                onClick={() => handleAIAnalyze(t)}
                                disabled={isAnalyzing}
                              >
                                {isAnalyzing
                                  ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />IA...</>
                                  : <><Brain className="h-3 w-3 mr-1" />{tr("tx.analyze_ia")}</>
                                }
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {t.flagged ? (
                              <Badge variant="destructive" className="text-xs">{tr("tx.status_flagged")}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">{tr("tx.status_normal")}</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedTx(t)}>
                                {tr("tx.details")}
                              </Button>
                              <Button size="sm" variant={t.flagged ? "outline" : "destructive"} className="h-7 text-xs" onClick={() => handleFlag(t)}>
                                {t.flagged ? tr("tx.unflag") : tr("tx.flag")}
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {/* AI Analysis expanded row */}
                        {aiResult && expandedAI === t.id && (
                          <tr className="border-b border-primary/20 bg-primary/5">
                            <td colSpan={9} className="px-4 py-3">
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-2"
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  <Brain className="h-4 w-4 text-primary" />
                                  <span className="text-sm font-bold text-primary">{tr("tx.ia_gemini_analysis")} — {t.ref}</span>
                                  <Badge variant={aiResult.riskScore >= 70 ? "destructive" : aiResult.riskScore >= 40 ? "secondary" : "outline"} className="text-xs">
                                    {tr("tx.risk")}: {aiResult.riskLevel}
                                  </Badge>
                                </div>
                                <p className="text-sm text-foreground leading-relaxed">{aiResult.explanation}</p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {aiResult.reasons?.map((r: string) => (
                                    <Badge key={r} variant="outline" className="text-xs border-primary/30 text-primary">{r}</Badge>
                                  ))}
                                  {aiResult.typologies?.filter((t: string) => t !== "none").map((t: string) => (
                                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                                  ))}
                                </div>
                                <div className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                                  aiResult.recommendedAction === "declarer_STR" || aiResult.recommendedAction === "bloquer"
                                    ? "bg-destructive/15 border-destructive/30 text-destructive"
                                    : aiResult.recommendedAction === "signaler"
                                    ? "bg-accent/15 border-accent/30 text-accent"
                                    : "bg-secondary/50 border-border text-muted-foreground"
                                }`}>
                                  <Zap className="h-3 w-3" />
                                  {tr("tx.recommended_action")}: {ACTION_LABELS[aiResult.recommendedAction]?.label || aiResult.recommendedAction}
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {pageItems.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">{tr("tx.no_tx")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {transactions.length > pageSize && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>{tr("tx.prev")}</Button>
          <span className="text-sm text-muted-foreground">{tr("common.page")} {page + 1} / {Math.ceil(transactions.length / pageSize)}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(Math.ceil(transactions.length / pageSize) - 1, page + 1))} disabled={page >= Math.ceil(transactions.length / pageSize) - 1}>{tr("tx.next")}</Button>
        </div>
      )}

      {selectedTx && (
        <Dialog open={!!selectedTx} onOpenChange={() => setSelectedTx(null)}>
          <DialogContent className="bg-card border-border">
             <DialogHeader><DialogTitle>{tr("tx.details")} — {selectedTx.ref}</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {[
                  [tr("common.date"), selectedTx.date],
                  [tr("tx.reference"), selectedTx.ref],
                  [tr("tx.account"), selectedTx.account],
                  [tr("tx.amount"), formatCurrency(selectedTx.amount)],
                  [tr("tx.channel"), selectedTx.channel],
                  [tr("common.status"), selectedTx.flagged ? tr("tx.status_flagged") : tr("tx.status_normal")],
                ].map(([k, v]) => (
                  <div key={k} className="p-2 bg-secondary/30 rounded">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="font-medium">{v}</div>
                  </div>
                ))}
              </div>
              {selectedTx.notes && (
                <div className="p-2 bg-secondary/30 rounded">
                  <div className="text-xs text-muted-foreground">Notes</div>
                  <div>{selectedTx.notes}</div>
                </div>
              )}
              {aiScores[selectedTx.id] && (
                <div className="p-3 bg-primary/10 border border-primary/20 rounded">
                  <div className="text-xs font-bold text-primary mb-1">🤖 Analyse IA Gemini</div>
                  <p className="text-xs text-foreground">{aiScores[selectedTx.id].explanation}</p>
                  <div className={`text-xs font-semibold mt-2 ${ACTION_LABELS[aiScores[selectedTx.id].recommendedAction]?.color || ""}`}>
                    → {ACTION_LABELS[aiScores[selectedTx.id].recommendedAction]?.label}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---- Blockchain Explorer ----
function BlockchainExplorer({ selectedAddress, setSelectedAddress, openExternal }: any) {
  const { data: addresses = [], isLoading } = useBlockchainAddresses();
  const addAddress = useAddBlockchainAddress();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const locale = language === "fr" ? "fr-FR" : "en-US";
  const { lookup, isLoading: ethLoading, data: ethData, error: ethError } = useEtherscanLookup();
  const [inputAddr, setInputAddr] = useState(selectedAddress || "");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState("ethereum");
  const [form, setForm] = useState({ address: "", network: "ethereum", risk_score: "0", label: "", notes: "" });

  const current = addresses.find((a: any) => a.address === selectedAddress) || null;

  const handleSearch = () => {
    if (inputAddr.trim()) {
      setSelectedAddress(inputAddr.trim());
      lookup(inputAddr.trim(), selectedNetwork);
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addAddress.mutateAsync({
        address: form.address,
        network: form.network,
        risk_score: parseInt(form.risk_score),
        label: form.label || undefined,
        notes: form.notes || undefined,
      });
      toast({ title: t("bc.address_added") });
      setShowAdd(false);
      setForm({ address: "", network: "ethereum", risk_score: "0", label: "", notes: "" });
    } catch (e: any) {
      toast({ title: t("bc.error_label"), description: e.message, variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">{t("bc.title")}</h2>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> {t("bc.add_address")}</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>{t("bc.new_address")}</DialogTitle></DialogHeader>
            <form onSubmit={handleAddAddress} className="space-y-3">
              <div>
                <Label>{t("bc.address")} *</Label>
                <Input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="0x..." className="bg-secondary/50 font-mono text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("bc.network")}</Label>
                  <Select value={form.network} onValueChange={v => setForm(f => ({ ...f, network: v }))}>
                    <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["ethereum", "bnb", "polygon"].map(n => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("bc.risk_score")}</Label>
                  <Input type="number" min="0" max="100" value={form.risk_score} onChange={e => setForm(f => ({ ...f, risk_score: e.target.value }))} className="bg-secondary/50" />
                </div>
              </div>
              <div>
                <Label>{t("bc.label")}</Label>
                <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Exchange, Whale..." className="bg-secondary/50" />
              </div>
              <div>
                <Label>{t("bc.notes")}</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-secondary/50" rows={2} />
              </div>
              <Button type="submit" className="w-full" disabled={addAddress.isPending}>
                {addAddress.isPending ? t("bc.adding") : t("bc.add_btn")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />{t("bc.search_onchain")}</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Select value={selectedNetwork} onValueChange={setSelectedNetwork}>
                  <SelectTrigger className="w-32 bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ethereum">Ethereum</SelectItem>
                    <SelectItem value="bnb">BNB Chain</SelectItem>
                    <SelectItem value="polygon">Polygon</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={inputAddr}
                  onChange={e => setInputAddr(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  className="bg-secondary/50 font-mono text-sm flex-1"
                  placeholder="0x..."
                />
                <Button onClick={handleSearch} disabled={ethLoading}>
                  {ethLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : t("bc.analyze")}
                </Button>
              </div>

              {ethError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">{ethError}</div>
              )}

              {ethData && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-secondary/30 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">{t("bc.balance")}</div>
                      <div className="font-bold text-lg text-primary">{ethData.balance} ETH</div>
                    </div>
                    <div className="p-3 bg-secondary/30 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">{t("bc.transactions")}</div>
                      <div className="font-bold text-lg">{ethData.transactionCount}</div>
                    </div>
                    <div className="p-3 bg-secondary/30 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">{t("bc.network")}</div>
                      <div className="font-bold capitalize">{ethData.network}</div>
                    </div>
                  </div>

                  {/* Flow analysis if available */}
                  {ethData.flowAnalysis && (
                    <div className="grid grid-cols-4 gap-2">
                      <div className="p-2 bg-primary/10 rounded text-center">
                        <div className="text-[10px] text-muted-foreground">{language === "fr" ? "Entrant" : "Inflow"}</div>
                        <div className="text-sm font-bold text-primary">{ethData.flowAnalysis.totalIn} ETH</div>
                      </div>
                      <div className="p-2 bg-destructive/10 rounded text-center">
                        <div className="text-[10px] text-muted-foreground">{language === "fr" ? "Sortant" : "Outflow"}</div>
                        <div className="text-sm font-bold text-destructive">{ethData.flowAnalysis.totalOut} ETH</div>
                      </div>
                      <div className="p-2 bg-accent/10 rounded text-center">
                        <div className="text-[10px] text-muted-foreground">{language === "fr" ? "Flux net" : "Net Flow"}</div>
                        <div className="text-sm font-bold text-accent">{ethData.flowAnalysis.netFlow} ETH</div>
                      </div>
                      <div className="p-2 bg-secondary/30 rounded text-center">
                        <div className="text-[10px] text-muted-foreground">{language === "fr" ? "Contreparties" : "Counterparties"}</div>
                        <div className="text-sm font-bold">{ethData.flowAnalysis.uniqueCounterparties}</div>
                      </div>
                    </div>
                  )}

                  {ethData.transactions.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t("bc.last_tx")}</div>
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {ethData.transactions.map((tx: any) => (
                          <div key={tx.hash} className={`p-2 rounded text-xs font-mono flex items-center justify-between ${tx.isError ? "bg-destructive/10 border border-destructive/20" : "bg-secondary/30"}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground truncate">{tx.hash.slice(0, 16)}...</span>
                                {tx.from?.toLowerCase() === ethData.address?.toLowerCase()
                                  ? <Badge variant="outline" className="text-[9px] h-4 px-1 border-destructive/30 text-destructive">OUT</Badge>
                                  : <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/30 text-primary">IN</Badge>
                                }
                              </div>
                              <span className="text-muted-foreground">{new Date(tx.timestamp).toLocaleDateString(locale)}</span>
                            </div>
                            <div className="text-right ml-3">
                              <div className={`font-semibold ${tx.isError ? "text-destructive" : "text-primary"}`}>{tx.value} ETH</div>
                              {tx.isError && <Badge variant="destructive" className="text-xs">{t("common.error")}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openExternal(`https://etherscan.io/address/${ethData.address}`)}>
                      {t("bc.view_etherscan")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openExternal(`https://debank.com/profile/${ethData.address}`)}>
                      DeBank
                    </Button>
                  </div>
                </div>
              )}

              {!ethData && !ethLoading && !ethError && (
                <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                  {t("bc.enter_address")}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedAddress && current && (
            <Card className="bg-card/50 border-border">
              <CardHeader><CardTitle className="text-base">{t("bc.internal_profile")}</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-secondary/30 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground">{t("bc.network")}</div>
                    <div className="font-semibold capitalize">{current.network}</div>
                  </div>
                  <div className="p-3 bg-secondary/30 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground">{t("bc.risk_score")}</div>
                    <div className={`font-bold text-lg ${(current.risk_score || 0) > 70 ? "text-destructive" : (current.risk_score || 0) > 40 ? "text-accent" : "text-primary"}`}>
                      {current.risk_score}
                    </div>
                  </div>
                  <div className="p-3 bg-secondary/30 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground">{t("bc.label")}</div>
                    <div className="font-semibold">{current.label || "—"}</div>
                  </div>
                </div>
                {current.notes && <p className="text-sm text-muted-foreground mt-3 p-2 bg-secondary/20 rounded">{current.notes}</p>}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("bc.tracked_addresses")} ({addresses.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : addresses.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("bc.no_addresses")}</div>
            ) : (
              addresses.map((a: any) => (
                <div
                  key={a.id}
                  className={`p-2 rounded cursor-pointer hover:bg-secondary/50 transition-colors ${selectedAddress === a.address ? "bg-accent/20 border border-accent/30" : "bg-secondary/30"}`}
                  onClick={() => { setSelectedAddress(a.address); setInputAddr(a.address); lookup(a.address, a.network); }}
                >
                  <div className="font-mono text-xs truncate">{a.address}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground capitalize">{a.network}</span>
                    <span className={`text-xs font-bold ${a.risk_score > 70 ? "text-destructive" : a.risk_score > 40 ? "text-accent" : "text-primary"}`}>
                      Score: {a.risk_score}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Analytics ----
function Analytics() {
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();

  const channelData = (() => {
    const map: Record<string, number> = {};
    transactions.forEach((t: any) => (map[t.channel] = (map[t.channel] || 0) + 1));
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();

  const weeklyTrend = (() => {
    const weeks: Record<string, { total: number; flagged: number }> = {};
    transactions.forEach((t: any) => {
      const w = t.date?.slice(0, 7) || "?";
      if (!weeks[w]) weeks[w] = { total: 0, flagged: 0 };
      weeks[w].total += Number(t.amount || 0);
      if (t.flagged) weeks[w].flagged += Number(t.amount || 0);
    });
    return Object.entries(weeks).slice(-6).map(([month, v]) => ({ month, ...v }));
  })();

  const totalVolume = transactions.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const flaggedVolume = transactions.filter((t: any) => t.flagged).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const COLORS = ["hsl(var(--accent))", "hsl(var(--primary))", "#22c55e", "#f59e0b", "#8b5cf6"];

  const { t } = useLanguage();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">{t("analytics.title")}</h2>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatsCard title={t("analytics.total_volume")} value={formatCurrency(totalVolume)} />
        <StatsCard title={t("analytics.flagged_volume")} value={formatCurrency(flaggedVolume)} warning />
        <StatsCard title={t("analytics.flag_rate")} value={`${totalVolume > 0 ? ((flaggedVolume / totalVolume) * 100).toFixed(1) : "0"}%`} danger />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("analytics.monthly_evolution")}</CardTitle></CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="total" name="Total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="flagged" name="Signalé" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("analytics.channel_dist")}</CardTitle></CardHeader>
          <CardContent>
            <div className="h-52">
              {channelData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">{t("common.no_data")}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={channelData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {channelData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("analytics.risk_indicators")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: t("analytics.suspicious_tx"), value: transactions.filter((t: any) => t.flagged).length, total: transactions.length },
              { label: t("dash.open_alerts"), value: alerts.filter((a: any) => a.status === "open").length, total: alerts.length },
            ].map(({ label, value, total }) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{label}</span>
                  <span className="font-semibold">{value} / {total}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-destructive rounded-full transition-all"
                    style={{ width: total > 0 ? `${(value / total) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">{t("analytics.severity_scores")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {["high", "medium", "low"].map(sev => {
              const count = alerts.filter((a: any) => a.severity === sev).length;
              return (
                <div key={sev} className="flex items-center gap-3">
                  <Badge variant={sev === "high" ? "destructive" : "secondary"} className="w-16 justify-center">{sev}</Badge>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: alerts.length > 0 ? `${(count / alerts.length) * 100}%` : "0%" }} />
                  </div>
                  <span className="text-sm font-semibold w-6">{count}</span>
                </div>
              );
            })}
            {alerts.length === 0 && <p className="text-sm text-muted-foreground">{t("analytics.no_alerts")}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Audit ----
function Audit() {
  const { t } = useLanguage();
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const createAlert = useCreateAlert();
  const { toast } = useToast();
  const [showAddAlert, setShowAddAlert] = useState(false);
  const [alertForm, setAlertForm] = useState({ title: "", description: "", severity: "medium" });

  const flagged = transactions.filter((t: any) => t.flagged);

  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAlert.mutateAsync(alertForm);
      toast({ title: "Alerte créée" });
      setShowAddAlert(false);
      setAlertForm({ title: "", description: "", severity: "medium" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">{t("audit.title")}</h2>
        <Dialog open={showAddAlert} onOpenChange={setShowAddAlert}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> {t("audit.new_alert")}</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>{t("audit.create_alert")}</DialogTitle></DialogHeader>
            <form onSubmit={handleAddAlert} className="space-y-3">
              <div>
                <Label>{t("audit.alert_title")} *</Label>
                <Input required value={alertForm.title} onChange={e => setAlertForm(f => ({ ...f, title: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div>
                <Label>{t("audit.description")}</Label>
                <Textarea value={alertForm.description} onChange={e => setAlertForm(f => ({ ...f, description: e.target.value }))} className="bg-secondary/50" rows={3} />
              </div>
              <div>
                <Label>{t("audit.severity")}</Label>
                <Select value={alertForm.severity} onValueChange={v => setAlertForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t("audit.sev_low")}</SelectItem>
                    <SelectItem value="medium">{t("audit.sev_medium")}</SelectItem>
                    <SelectItem value="high">{t("audit.sev_high")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createAlert.isPending}>
                {createAlert.isPending ? t("audit.creating") : t("audit.create_btn")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {t("audit.flagged_tx")} ({flagged.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : flagged.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">{t("audit.no_critical")}</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {flagged.map((t: any) => (
                  <div key={t.id} className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-medium">{t.ref}</span>
                      <span className="font-semibold text-sm">{formatCurrency(t.amount)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{t.date}</span>
                      <span>·</span>
                      <span>{t.account}</span>
                      <span>·</span>
                      <span>{t.channel}</span>
                    </div>
                    {t.notes && <p className="text-xs mt-1 text-muted-foreground">{t.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("audit.investigation_workflow")}</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2">
                  {[t("audit.step1"), t("audit.step2"), t("audit.step3"), t("audit.step4"), t("audit.step5"), t("audit.step6")].map((step, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("audit.alerts")} ({alerts.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-48 overflow-y-auto">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("audit.no_alerts")}</p>
              ) : (
                alerts.map((a: any) => (
                  <div key={a.id} className="p-2 rounded bg-secondary/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{a.title}</span>
                      <Badge variant={a.severity === "high" ? "destructive" : "secondary"} className="text-xs">{a.severity}</Badge>
                    </div>
                    {a.description && <p className="text-xs text-muted-foreground mt-1">{a.description}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---- Geolocation ----
function Geolocation() {
  const { data: transactions = [] } = useTransactions();
  const { t, language } = useLanguage();
  const channelCounts: Record<string, number> = {};
  transactions.forEach((t: any) => (channelCounts[t.channel] = (channelCounts[t.channel] || 0) + 1));

  const COUNTRY_FLOW = [
    { country: language === "fr" ? "Sénégal" : "Senegal", pct: "42%", volume: "4 200 000 XOF", color: "#22c55e" },
    { country: language === "fr" ? "Côte d'Ivoire" : "Ivory Coast", pct: "28%", volume: "2 800 000 XOF", color: "#f59e0b" },
    { country: "Mali", pct: "18%", volume: "1 800 000 XOF", color: "#3b82f6" },
    { country: "Burkina Faso", pct: "8%", volume: "800 000 XOF", color: "#8b5cf6" },
    { country: language === "fr" ? "Guinée" : "Guinea", pct: "4%", volume: "400 000 XOF", color: "#ec4899" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">{t("geo.title")}</h2>
        <Badge variant="secondary" className="text-xs">{t("geo.simulated")}</Badge>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-4">
        {COUNTRY_FLOW.map(({ country, pct, color }) => (
          <Card key={country} className="bg-card/50 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">{country}</div>
              <div className="text-xl font-bold" style={{ color }}>{pct}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        {Object.entries(channelCounts).map(([channel, count]) => (
          <StatsCard key={channel} title={channel} value={`${count} tx`} />
        ))}
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Map className="h-4 w-4" /> Carte interactive — Flux financiers Afrique de l'Ouest
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[500px] overflow-hidden rounded-b-lg">
            <LeafletMap className="h-full w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Reports ----
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function Reports({ openExternal }: any) {
  const { data: reports = [], isLoading } = useReports();
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const createReport = useCreateReport();
  const { data: profile } = useProfile();
  const { user } = useAuth();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", report_type: "AML", content: "" });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createReport.mutateAsync(form);
      toast({ title: "Rapport créé" });
      setShowAdd(false);
      setForm({ title: "", report_type: "AML", content: "" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const generateAutoReport = async () => {
    const flagged = transactions.filter((t: any) => t.flagged);
    const content = `RAPPORT AML AUTOMATIQUE — DeepAuditAI
Date: ${new Date().toLocaleDateString("fr-FR")}
Organisme: ${profile?.organization || "Non renseigné"}

RÉSUMÉ EXÉCUTIF:
- Total transactions analysées: ${transactions.length}
- Transactions signalées: ${flagged.length}
- Alertes actives: ${alerts.filter((a: any) => a.status === "open").length}
- Volume total: ${formatCurrency(transactions.reduce((s: number, t: any) => s + Number(t.amount || 0), 0))}

CAS SIGNALÉS:
${flagged.map((t: any) => `- ${t.ref} | ${t.account} | ${formatCurrency(t.amount)} | ${t.channel} | ${t.date}`).join("\n") || "Aucun cas signalé"}

ALERTES ACTIVES:
${alerts.filter((a: any) => a.status === "open").slice(0, 10).map((a: any) => `- [${a.severity?.toUpperCase()}] ${a.title}`).join("\n") || "Aucune alerte"}

Score de risque AML des transactions signalées:
${flagged.map((t: any) => {
  const { score, reasons } = computeAMLScore(t, transactions);
  return `  ${t.ref}: Score ${score}/100 — ${reasons.join(", ")}`;
}).join("\n") || "N/A"}

Rapport généré conformément aux exigences CENTIF/BCEAO.`;
    try {
      await createReport.mutateAsync({
        title: `Rapport AML — ${new Date().toLocaleDateString("fr-FR")}`,
        report_type: "AML",
        content,
      });
      toast({ title: "Rapport AML généré automatiquement" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const exportPDF = async (report: any) => {
    const content = report.content || "";
    const hash = await sha256(content);
    const exportedAt = new Date().toISOString();
    const exportedBy = profile?.full_name || user?.email || "Inconnu";

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 18;
    let y = 20;

    // Header bar
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 30, "F");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("DeepAuditAI — Rapport Officiel", margin, 14);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Conforme CENTIF / BCEAO — Afrique de l'Ouest", margin, 22);

    y = 38;
    doc.setTextColor(30, 30, 40);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(report.title, margin, y);

    y += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 120);
    doc.text(`Type: ${report.report_type}   |   Statut: ${report.status}   |   Créé le: ${new Date(report.created_at).toLocaleDateString("fr-FR")}`, margin, y);

    y += 10;
    doc.setDrawColor(200, 200, 210);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    // Content
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 40);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(content, pageW - margin * 2);
    lines.forEach((line: string) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += 5.5;
    });

    // Footer with hash, audit trail
    const footerY = doc.internal.pageSize.getHeight() - 28;
    doc.setFillColor(245, 245, 248);
    doc.rect(0, footerY - 4, pageW, 32, "F");
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 100);
    doc.setFont("helvetica", "bold");
    doc.text("MÉTADONNÉES D'AUDIT — Chaîne de custody", margin, footerY + 2);
    doc.setFont("helvetica", "normal");
    doc.text(`Exporté par: ${exportedBy}`, margin, footerY + 8);
    doc.text(`Date export: ${new Date(exportedAt).toLocaleString("fr-FR")}`, margin, footerY + 14);
    doc.text(`SHA-256: ${hash}`, margin, footerY + 20);
    doc.text("Document officiel — Usage confidentiel — DeepAuditAI © 2025", pageW / 2, footerY + 26, { align: "center" });

    doc.save(`DeepAuditAI_${report.report_type}_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast({ title: "PDF exporté", description: `SHA-256: ${hash.slice(0, 16)}...` });
  };

  const exportCSV = () => {
    const headers = "date,ref,account,amount,channel,flagged";
    const rows = transactions.map((t: any) => `${t.date},${t.ref},${t.account},${t.amount},${t.channel},${t.flagged}`);
    const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport_transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Rapports</h2>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={generateAutoReport} disabled={createReport.isPending}>
            Générer rapport AML
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            Exporter CSV
          </Button>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nouveau rapport</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>Nouveau rapport</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-3">
                <div>
                  <Label>Titre *</Label>
                  <Input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="bg-secondary/50" />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.report_type} onValueChange={v => setForm(f => ({ ...f, report_type: v }))}>
                    <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["AML", "Audit", "Conformité", "Investigation", "Synthèse"].map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Contenu</Label>
                  <Textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} className="bg-secondary/50 font-mono text-sm" rows={6} />
                </div>
                <Button type="submit" className="w-full" disabled={createReport.isPending}>
                  {createReport.isPending ? "Création..." : "Créer le rapport"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-3 text-center text-muted-foreground py-8">Chargement...</div>
        ) : reports.length === 0 ? (
          <div className="col-span-3 text-center py-12 border border-dashed border-border rounded-lg text-muted-foreground">
            Aucun rapport. Générez un rapport AML ou créez-en un manuellement.
          </div>
        ) : (
          reports.map((r: any) => (
            <Card key={r.id} className="bg-card/50 border-border">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm font-semibold">{r.title}</CardTitle>
                  <Badge variant="secondary" className="text-xs ml-2 shrink-0">{r.report_type}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-3">
                  {new Date(r.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
                </div>
                {r.content && (
                  <pre className="text-xs text-muted-foreground bg-secondary/30 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
                    {r.content.slice(0, 200)}{r.content.length > 200 ? "..." : ""}
                  </pre>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant={r.status === "draft" ? "outline" : "default"} className="text-xs">{r.status}</Badge>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => exportPDF(r)}>
                    📄 PDF signé
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// ---- Executive Realtime KPI Panel (for Settings → Automation) ----
function ExecutiveRealtimeKPIs() {
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { data: strReports = [] } = useQuery({
    queryKey: ["str_reports_kpi"],
    queryFn: async () => {
      const { data, error } = await supabase.from("str_reports").select("id,status,created_at,transaction_amount");
      if (error) throw error;
      return data || [];
    },
  });

  const pendingSTR = strReports.filter((s: any) => s.status === "pending_approval").length;
  const openAlerts = alerts.filter((a: any) => a.status === "open").length;
  const highAlerts = alerts.filter((a: any) => a.severity === "high" && a.status === "open").length;
  const avgScore = transactions.length > 0
    ? Math.round(transactions.reduce((s: number, t: any) => s + computeAMLScore(t, transactions).score, 0) / transactions.length)
    : 0;

  // 7-day daily data
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const dailyData = last7Days.map(day => {
    const dayTx = transactions.filter((t: any) => (t.date || "").slice(0, 10) === day);
    const dayAlerts = alerts.filter((a: any) => (a.created_at || "").slice(0, 10) === day);
    const daySTR = strReports.filter((s: any) => (s.created_at || "").slice(0, 10) === day);
    const scores = dayTx.map((t: any) => computeAMLScore(t, transactions).score);
    const avgDayScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
    return {
      day: day.slice(5),
      tx: dayTx.length,
      alerts: dayAlerts.length,
      str: daySTR.length,
      score: avgDayScore,
    };
  });

  const COLORS = {
    primary: "hsl(var(--primary))",
    accent: "hsl(var(--accent))",
    destructive: "hsl(var(--destructive))",
  };

  return (
    <div className="space-y-4 mb-6 pb-6 border-b border-border">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold">Tableau de bord exécutif — Temps réel</h3>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-3">
        <div className={`rounded-lg p-3 text-center border ${pendingSTR > 0 ? "bg-accent/10 border-accent/30" : "bg-secondary/30 border-transparent"}`}>
          <div className={`text-3xl font-bold ${pendingSTR > 0 ? "text-accent" : "text-foreground"}`}>{pendingSTR}</div>
          <div className="text-xs text-muted-foreground mt-0.5">STR en attente</div>
          {pendingSTR > 0 && <div className="text-xs text-accent mt-1 font-medium">⚠ Approbation requise</div>}
        </div>
        <div className={`rounded-lg p-3 text-center border ${openAlerts > 0 ? "bg-destructive/10 border-destructive/30" : "bg-secondary/30 border-transparent"}`}>
          <div className={`text-3xl font-bold ${openAlerts > 0 ? "text-destructive" : "text-foreground"}`}>{openAlerts}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Alertes ouvertes</div>
          {highAlerts > 0 && <div className="text-xs text-destructive mt-1 font-medium">{highAlerts} haute sév.</div>}
        </div>
        <div className={`rounded-lg p-3 text-center border ${avgScore >= 60 ? "bg-destructive/10 border-destructive/30" : avgScore >= 30 ? "bg-accent/10 border-accent/30" : "bg-secondary/30 border-transparent"}`}>
          <div className={`text-3xl font-bold ${avgScore >= 60 ? "text-destructive" : avgScore >= 30 ? "text-accent" : "text-primary"}`}>{avgScore}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Score AML moyen</div>
          <div className="text-xs text-muted-foreground mt-1">/100</div>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3 text-center border border-transparent">
          <div className="text-3xl font-bold text-foreground">{transactions.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Transactions</div>
          <div className="text-xs text-muted-foreground mt-1">{transactions.filter((t: any) => t.flagged).length} signalées</div>
        </div>
      </div>

      {/* 7-day chart */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Activité des 7 derniers jours
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(val, name) => [val, name === "tx" ? "Transactions" : name === "alerts" ? "Alertes" : name === "str" ? "STR" : "Score moy."]}
                />
                <Legend formatter={(val) => val === "tx" ? "Transactions" : val === "alerts" ? "Alertes" : val === "str" ? "STR" : "Score moy."} />
                <Bar dataKey="tx" fill={COLORS.primary} radius={[3, 3, 0, 0]} />
                <Bar dataKey="alerts" fill={COLORS.destructive} radius={[3, 3, 0, 0]} opacity={0.8} />
                <Bar dataKey="str" fill={COLORS.accent} radius={[3, 3, 0, 0]} opacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Cron Monitoring Panel ----
function CronMonitoringPanel({ userRole }: { userRole?: string | null }) {
  const { toast } = useToast();
  const [cronData, setCronData] = useState<{ jobs: any[]; runs: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const canAccess = ["superadmin", "org_admin"].includes(userRole || "");

  const fetchCronData = async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/cron-monitor`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setCronData(data);
      setLastRefresh(new Date());
    } catch (e: any) {
      toast({ title: "Erreur monitoring", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCronData(); }, [canAccess]);

  if (!canAccess) {
    return (
      <Card className="bg-card/50 border-border">
        <CardContent className="py-8 text-center">
          <Shield className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Réservé aux superadmin / org_admin</p>
        </CardContent>
      </Card>
    );
  }

  const jobs = cronData?.jobs || [];
  const runs = cronData?.runs || [];
  const successRuns = runs.filter((r: any) => r.status === "succeeded").length;
  const failedRuns = runs.filter((r: any) => r.status === "failed").length;
  const successRate = runs.length > 0 ? Math.round((successRuns / runs.length) * 100) : null;

  // Group runs by job
  const runsByJob: Record<string, any[]> = {};
  runs.forEach((r: any) => {
    const key = String(r.jobid);
    if (!runsByJob[key]) runsByJob[key] = [];
    runsByJob[key].push(r);
  });

  // Status badge helper
  const statusBadge = (status: string) => {
    if (status === "succeeded") return <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/15 text-primary">✓ Succès</span>;
    if (status === "failed") return <span className="px-2 py-0.5 rounded text-xs font-medium bg-destructive/15 text-destructive">✗ Échec</span>;
    if (status === "running") return <span className="px-2 py-0.5 rounded text-xs font-medium bg-accent/15 text-accent animate-pulse">⟳ En cours</span>;
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-secondary text-muted-foreground">{status}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Executive realtime KPIs at top of Automation tab */}
      <ExecutiveRealtimeKPIs />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-base font-semibold">Monitoring Automatisation — pg_cron</h3>
            {lastRefresh && (
              <p className="text-xs text-muted-foreground">Actualisé à {lastRefresh.toLocaleTimeString("fr-FR")}</p>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={fetchCronData} disabled={loading} className="gap-1.5 h-7 text-xs">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {loading && !cronData && (
        <div className="py-8 text-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Chargement des logs...</p>
        </div>
      )}

      {cronData && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-secondary/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{jobs.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Jobs actifs</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{runs.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Exécutions (30j)</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${successRate !== null && successRate < 80 ? "bg-destructive/10" : "bg-primary/10"}`}>
              <div className={`text-2xl font-bold ${successRate !== null && successRate < 80 ? "text-destructive" : "text-primary"}`}>
                {successRate !== null ? `${successRate}%` : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Taux de succès</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${failedRuns > 0 ? "bg-destructive/10" : "bg-secondary/30"}`}>
              <div className={`text-2xl font-bold ${failedRuns > 0 ? "text-destructive" : "text-muted-foreground"}`}>{failedRuns}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Échecs</div>
            </div>
          </div>

          {/* Jobs list */}
          {jobs.length > 0 && (
            <Card className="bg-card/50 border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-accent" />
                  Jobs programmés ({jobs.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {jobs.map((job: any) => {
                  const jobRuns = runsByJob[String(job.jobid)] || [];
                  const lastRun = jobRuns[0];
                  return (
                    <div key={job.jobid} className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{job.jobname}</span>
                          {job.active
                            ? <span className="px-1.5 py-0.5 rounded text-xs bg-primary/15 text-primary">Actif</span>
                            : <span className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">Inactif</span>
                          }
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 font-mono">{job.schedule} (UTC)</div>
                      </div>
                      <div className="text-right ml-4">
                        {lastRun ? (
                          <>
                            {statusBadge(lastRun.status)}
                            <div className="text-xs text-muted-foreground mt-1">
                              {new Date(lastRun.start_time).toLocaleString("fr-FR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Jamais exécuté</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Run history */}
          <Card className="bg-card/50 border-border">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Historique des exécutions (30 dernières)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {runs.length === 0 ? (
                <div className="py-8 text-center">
                  <Clock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Aucune exécution enregistrée</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Le premier rapport sera généré lundi à 08h00 UTC</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {runs.map((run: any) => {
                    const jobName = jobs.find((j: any) => j.jobid === run.jobid)?.jobname || `Job #${run.jobid}`;
                    const duration = run.duration_ms != null ? `${Math.round(run.duration_ms)}ms` : "—";
                    const hasError = run.status === "failed" && run.return_message;
                    return (
                      <div key={run.runid} className={`flex items-start gap-3 p-2.5 rounded-lg text-xs ${hasError ? "bg-destructive/8 border border-destructive/20" : "bg-secondary/20"}`}>
                        <div className="mt-0.5">{statusBadge(run.status)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate">{jobName}</div>
                          {hasError && (
                            <div className="text-destructive mt-0.5 break-words">{run.return_message}</div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-muted-foreground">
                            {new Date(run.start_time).toLocaleString("fr-FR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div className="text-muted-foreground/70">{duration}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Next scheduled info */}
          <div className="flex items-center gap-2 p-3 bg-primary/8 border border-primary/20 rounded-lg">
            <Clock className="h-4 w-4 text-primary shrink-0" />
            <div className="text-xs">
              <span className="font-medium text-foreground">Prochain rapport hebdomadaire :</span>
              <span className="text-muted-foreground ml-1">Lundi à 08h00 UTC · Email automatique si Resend est configuré</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Settings ----
function SettingsModule() {
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: userRole } = useUserRole();
  const { t, language } = useLanguage();
  const [form, setForm] = useState({ full_name: "", organization: "" });
  const [settingsTab, setSettingsTab] = useState<"profile" | "connectors" | "users" | "cron">("profile");

  // API Keys state
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyForm, setNewKeyForm] = useState<Record<string, string>>({});

  const CONNECTORS = [
    { service: "etherscan", name: "Etherscan API", desc: language === "fr" ? "Données blockchain Ethereum" : "Ethereum blockchain data", url: "https://etherscan.io/apis" },
    { service: "bscscan", name: "BscScan API", desc: language === "fr" ? "Données blockchain BNB Chain" : "BNB Chain blockchain data", url: "https://bscscan.com/apis" },
    { service: "polygonscan", name: "PolygonScan API", desc: language === "fr" ? "Données blockchain Polygon" : "Polygon blockchain data", url: "https://polygonscan.com/apis" },
    { service: "resend", name: "Resend Email", desc: language === "fr" ? "Envoi rapports hebdomadaires par email" : "Weekly report email delivery", url: "https://resend.com/api-keys" },
  ];

  React.useEffect(() => {
    if (profile) setForm({ full_name: profile.full_name || "", organization: profile.organization || "" });
  }, [profile]);

  // Fetch API keys
  React.useEffect(() => {
    const fetchKeys = async () => {
      setApiKeysLoading(true);
      const { data } = await supabase.from("api_keys").select("*").order("created_at", { ascending: true });
      setApiKeys(data || []);
      setApiKeysLoading(false);
    };
    if (settingsTab === "connectors") fetchKeys();
  }, [settingsTab]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync(form);
      toast({ title: t("settings.profile_updated") });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const saveApiKey = async (serviceName: string) => {
    const keyValue = newKeyForm[serviceName];
    if (!keyValue?.trim()) return;
    try {
      const existing = apiKeys.find(k => k.service_name === serviceName);
      if (existing) {
        await supabase.from("api_keys").update({ api_key: keyValue, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        const { data: { user: u } } = await supabase.auth.getUser();
        if (!u) return;
        await supabase.from("api_keys").insert({ user_id: u.id, service_name: serviceName, api_key: keyValue });
      }
      toast({ title: t("settings.api_key_saved") });
      setNewKeyForm(prev => ({ ...prev, [serviceName]: "" }));
      // Refresh
      const { data } = await supabase.from("api_keys").select("*").order("created_at", { ascending: true });
      setApiKeys(data || []);
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const deleteApiKey = async (id: string) => {
    await supabase.from("api_keys").delete().eq("id", id);
    toast({ title: t("settings.api_key_deleted") });
    setApiKeys(prev => prev.filter(k => k.id !== id));
  };

  const isAdmin = ["superadmin", "org_admin"].includes(userRole || "");

  const tabs = [
    { key: "profile" as const, label: t("settings.profile") },
    { key: "connectors" as const, label: t("settings.connectors") },
    ...(isAdmin ? [
      { key: "users" as const, label: t("settings.users_tab") },
      { key: "cron" as const, label: t("settings.automation") },
    ] : []),
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{t("settings.title")}</h2>
        <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg">
          {tabs.map(tb => (
            <button
              key={tb.key}
              onClick={() => setSettingsTab(tb.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${settingsTab === tb.key ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {settingsTab === "profile" && (
        <div className="grid grid-cols-2 gap-6">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("settings.profile_title")}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label>{t("settings.email")}</Label>
                  <Input value={user?.email || ""} disabled className="bg-secondary/30 text-muted-foreground" />
                </div>
                <div>
                  <Label>{t("settings.fullname")}</Label>
                  <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="bg-secondary/50" />
                </div>
                <div>
                  <Label>{t("settings.organization")}</Label>
                  <Input value={form.organization} onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} placeholder={t("settings.org_placeholder")} className="bg-secondary/50" />
                </div>
                <div>
                  <Label>{t("settings.role")}</Label>
                  <Input value={profile?.role || "auditor"} disabled className="bg-secondary/30 text-muted-foreground" />
                </div>
                <Button type="submit" disabled={updateProfile.isPending}>
                  {updateProfile.isPending ? t("settings.saving") : t("settings.save")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">{t("settings.roles_perms")}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { role: "superadmin", desc: t("role.superadmin") },
                  { role: "org_admin", desc: t("role.org_admin") },
                  { role: "compliance_manager", desc: t("role.compliance_manager") },
                  { role: "analyst", desc: t("role.analyst") },
                  { role: "forensic_analyst", desc: t("role.forensic_analyst") },
                  { role: "auditor", desc: t("role.auditor") },
                  { role: "read_only", desc: t("role.read_only") },
                ].map(({ role, desc }) => (
                  <div key={role} className={`flex items-center justify-between p-2 rounded text-sm ${profile?.role === role ? "bg-accent/20 border border-accent/30" : "bg-secondary/30"}`}>
                    <span className="font-medium">{role}</span>
                    <span className="text-xs text-muted-foreground">{desc}</span>
                    {profile?.role === role && <Badge className="text-xs ml-2">{t("settings.current")}</Badge>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {settingsTab === "connectors" && (
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-base">{t("settings.connectors_title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{t("settings.connectors_desc")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {apiKeysLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">{t("common.loading")}</div>
            ) : (
              CONNECTORS.map(({ service, name, desc, url }) => {
                const existing = apiKeys.find(k => k.service_name === service);
                const maskedKey = existing ? `${existing.api_key.slice(0, 8)}...${existing.api_key.slice(-4)}` : null;
                return (
                  <div key={service} className="p-4 bg-secondary/20 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{name}</div>
                        <div className="text-xs text-muted-foreground">{desc}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {existing ? (
                          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">{t("settings.api_key_active")} ✓</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">{t("settings.api_key_inactive")}</Badge>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => window.open(url, "_blank")}>
                          {t("settings.api_key_get")} →
                        </Button>
                      </div>
                    </div>
                    {existing && (
                      <div className="flex items-center gap-2 mb-2 p-2 bg-primary/5 rounded border border-primary/10">
                        <span className="font-mono text-xs text-muted-foreground flex-1">{maskedKey}</span>
                        <Button variant="outline" size="sm" className="h-6 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => deleteApiKey(existing.id)}>
                          {t("settings.api_key_remove")}
                        </Button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={newKeyForm[service] || ""}
                        onChange={e => setNewKeyForm(prev => ({ ...prev, [service]: e.target.value }))}
                        placeholder={t("settings.api_key_placeholder")}
                        className="bg-secondary/50 text-sm h-8 font-mono flex-1"
                      />
                      <Button size="sm" className="h-8 text-xs" onClick={() => saveApiKey(service)} disabled={!newKeyForm[service]?.trim()}>
                        {existing ? t("settings.api_key_update") : t("settings.api_key_add")}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
            <p className="text-xs text-muted-foreground pt-1 flex items-center gap-1">
              <Shield className="h-3 w-3" />
              {t("settings.api_key_info")}
            </p>
          </CardContent>
        </Card>
      )}

      {settingsTab === "users" && isAdmin && (
        <UsersManagement userRole={userRole} />
      )}

      {settingsTab === "cron" && (
        <CronMonitoringPanel userRole={userRole} />
      )}
    </div>
  );
}

// ---- Compliance BCEAO/CENTIF ----
const BCEAO_ITEMS = [
  { category: "KYC", item: "Identification et vérification de l'identité des clients" },
  { category: "KYC", item: "Vérification des bénéficiaires effectifs" },
  { category: "KYC", item: "Évaluation du profil de risque client" },
  { category: "KYC", item: "Mise à jour périodique des dossiers clients (tous les 3 ans)" },
  { category: "Surveillance", item: "Surveillance continue des transactions" },
  { category: "Surveillance", item: "Détection automatique des opérations suspectes" },
  { category: "Surveillance", item: "Seuil de déclaration: transactions ≥ 1 000 000 XOF" },
  { category: "Surveillance", item: "Contrôle des virements internationaux" },
  { category: "Déclaration", item: "Procédure de déclaration de soupçon (DS) à la CENTIF" },
  { category: "Déclaration", item: "Délai de déclaration: 24h après détection" },
  { category: "Déclaration", item: "Conservation des dossiers: 10 ans minimum" },
  { category: "Déclaration", item: "Formation du personnel sur les typologies AML" },
  { category: "Gouvernance", item: "Désignation d'un Responsable LBC/FT" },
  { category: "Gouvernance", item: "Politique LBC/FT approuvée par la direction" },
  { category: "Gouvernance", item: "Audit interne annuel LBC/FT" },
  { category: "Gouvernance", item: "Rapport annuel de conformité" },
];

function ComplianceBCEAO() {
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { data: reports = [] } = useReports();
  const createReport = useCreateReport();
  const { data: profile } = useProfile();
  const { user } = useAuth();
  const { toast } = useToast();
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem("bceao_checklist");
    return saved ? JSON.parse(saved) : {};
  });
  const [strForm, setStrForm] = useState({
    subject_name: "", subject_account: "", transaction_amount: "", transaction_date: new Date().toISOString().slice(0, 10),
    transaction_channel: "Bank", suspicious_nature: "", narrative: "",
  });
  const [showSTR, setShowSTR] = useState(false);
  const [strReports, setStrReports] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiNarratives, setAiNarratives] = useState<Record<string, string>>({});

  const toggleItem = (key: string) => {
    const updated = { ...checklist, [key]: !checklist[key] };
    setChecklist(updated);
    localStorage.setItem("bceao_checklist", JSON.stringify(updated));
  };

  const completedCount = Object.values(checklist).filter(Boolean).length;
  const totalItems = BCEAO_ITEMS.length;
  const complianceScore = Math.round((completedCount / totalItems) * 100);

  const categories = [...new Set(BCEAO_ITEMS.map(i => i.category))];

  const highAlerts = alerts.filter((a: any) => a.severity === "high" && a.status === "open");
  const flaggedTx = transactions.filter((t: any) => t.flagged);

  const generateSTRNarrative = async (alertItem: any) => {
    setAiLoading(alertItem.id);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/aml-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ alert: alertItem, transactions: transactions.slice(0, 20) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur IA");
      setAiNarratives(prev => ({ ...prev, [alertItem.id]: data.narrative }));
    } catch (e: any) {
      toast({ title: "Erreur IA", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(null);
    }
  };

  const submitSTR = async (e: React.FormEvent) => {
    e.preventDefault();
    const ref = `STR-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
    const entry = { ...strForm, ref, status: "submitted", submitted_at: new Date().toISOString(), id: crypto.randomUUID() };
    setStrReports(prev => [entry, ...prev]);
    try {
      await createReport.mutateAsync({
        title: `Déclaration STR ${ref} — ${strForm.subject_name}`,
        report_type: "STR",
        content: `DÉCLARATION DE SOUPÇON (STR) — CENTIF\nRéférence: ${ref}\nDate: ${new Date().toLocaleDateString("fr-FR")}\n\nSujet: ${strForm.subject_name}\nCompte: ${strForm.subject_account || "N/A"}\nTransaction: ${strForm.transaction_amount} XOF via ${strForm.transaction_channel} le ${strForm.transaction_date}\n\nNature suspecte: ${strForm.suspicious_nature}\n\nNarration d'investigation:\n${strForm.narrative || "À compléter"}\n\nDéclarant: ${profile?.full_name || user?.email}\nOrganisme: ${profile?.organization || "Non renseigné"}`,
      });
      toast({ title: `✅ STR ${ref} soumise à la CENTIF` });
      setShowSTR(false);
      setStrForm({ subject_name: "", subject_account: "", transaction_amount: "", transaction_date: new Date().toISOString().slice(0, 10), transaction_channel: "Bank", suspicious_nature: "", narrative: "" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  // Per-category compliance scores for radial chart
  const categoryScores = categories.map(cat => {
    const items = BCEAO_ITEMS.filter(i => i.category === cat);
    const done = items.filter(({ item }) => !!checklist[`${cat}::${item}`]).length;
    return { name: cat, score: Math.round((done / items.length) * 100), done, total: items.length };
  });

  const CATEGORY_COLORS: Record<string, string> = {
    KYC: "hsl(var(--primary))",
    Surveillance: "hsl(var(--accent))",
    Déclaration: "#22c55e",
    Gouvernance: "#f59e0b",
  };

  // Custom circular gauge using SVG
  function CircularGauge({ value, color, size = 80 }: { value: number; color: string; size?: number }) {
    const r = (size - 12) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (value / 100) * circ;
    return (
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Conformité Réglementaire BCEAO/CENTIF</h2>
          <p className="text-sm text-muted-foreground">Checklist LBC/FT · Déclarations STR · Indicateurs temps réel</p>
        </div>
        <div className="flex gap-2">
          <Badge className={`${complianceScore >= 75 ? "bg-primary/20 text-primary" : complianceScore >= 50 ? "bg-accent/20 text-accent" : "bg-destructive/20 text-destructive"} border`}>
            {complianceScore}% conforme
          </Badge>
          <Button size="sm" onClick={() => setShowSTR(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nouvelle STR
          </Button>
        </div>
      </div>

      {/* Circular dashboard — global + per category */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {/* Global circular gauge */}
        <Card className="bg-card/50 border-border col-span-1 flex flex-col items-center justify-center p-4">
          <div className="relative flex items-center justify-center">
            <CircularGauge
              value={complianceScore}
              color={complianceScore >= 75 ? "hsl(var(--primary))" : complianceScore >= 50 ? "hsl(var(--accent))" : "hsl(var(--destructive))"}
              size={100}
            />
            <div className="absolute text-center pointer-events-none">
              <div className={`text-xl font-black leading-none ${complianceScore >= 75 ? "text-primary" : complianceScore >= 50 ? "text-accent" : "text-destructive"}`}>
                {complianceScore}%
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2 text-center font-medium">Score global</div>
          <div className="text-xs mt-1 text-center">
            {complianceScore >= 75 ? "✅ Conforme" : complianceScore >= 50 ? "⚠️ Attention" : "🚨 Non conforme"}
          </div>
        </Card>

        {/* Per-category gauges */}
        {categoryScores.map(({ name, score, done, total }) => (
          <Card key={name} className="bg-card/50 border-border flex flex-col items-center justify-center p-4">
            <div className="relative flex items-center justify-center">
              <CircularGauge value={score} color={CATEGORY_COLORS[name] || "hsl(var(--primary))"} size={80} />
              <div className="absolute text-center pointer-events-none">
                <div className="text-sm font-black leading-none" style={{ color: CATEGORY_COLORS[name] }}>{score}%</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-2 text-center font-medium">{name}</div>
            <div className="flex items-center gap-1 mt-1">
              {score === 100 ? (
                <CheckCircle2 className="h-3 w-3 text-primary" />
              ) : score >= 50 ? (
                <div className="w-2 h-2 rounded-full bg-accent" />
              ) : (
                <XCircle className="h-3 w-3 text-destructive" />
              )}
              <span className="text-xs text-muted-foreground">{done}/{total}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Checklist */}
        <div className="col-span-2 space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Checklist LBC/FT — Obligations BCEAO</CardTitle>
                <div className="text-xs text-muted-foreground">{completedCount}/{totalItems} items validés</div>
              </div>
            </CardHeader>
            <CardContent>
              {categories.map(cat => (
                <div key={cat} className="mb-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                    <Shield className="h-3 w-3" /> {cat}
                  </div>
                  <div className="space-y-2">
                    {BCEAO_ITEMS.filter(i => i.category === cat).map(({ item }) => {
                      const key = `${cat}::${item}`;
                      const done = !!checklist[key];
                      return (
                        <button
                          key={key}
                          onClick={() => toggleItem(key)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left text-sm transition-all ${done ? "bg-primary/10 border border-primary/20" : "bg-secondary/30 hover:bg-secondary/50"}`}
                        >
                          <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-all ${done ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                            {done && <span className="text-xs font-bold">✓</span>}
                          </div>
                          <span className={done ? "line-through text-muted-foreground" : "text-foreground"}>{item}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* High-risk alerts with AI analysis */}
          {highAlerts.length > 0 && (
            <Card className="bg-card/50 border-destructive/30 border">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Alertes nécessitant une STR ({highAlerts.length})</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {highAlerts.slice(0, 5).map((a: any) => (
                  <div key={a.id} className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">{a.title}</span>
                      <div className="flex gap-2">
                        <Badge variant="destructive" className="text-xs">{a.severity}</Badge>
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => generateSTRNarrative(a)} disabled={aiLoading === a.id}>
                          {aiLoading === a.id ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />IA...</> : "🤖 Analyser IA"}
                        </Button>
                      </div>
                    </div>
                    {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                    {aiNarratives[a.id] && (
                      <div className="mt-2 p-2 bg-primary/10 border border-primary/20 rounded text-xs whitespace-pre-wrap text-foreground">
                        <div className="text-xs font-bold text-primary mb-1">🤖 Narration IA — Gemini</div>
                        {aiNarratives[a.id]}
                      </div>
                    )}
                    <div className="mt-2">
                      <Button size="sm" variant="secondary" className="h-6 text-xs" onClick={() => { setStrForm(f => ({ ...f, suspicious_nature: a.title, narrative: aiNarratives[a.id] || a.description || "" })); setShowSTR(true); }}>
                        → Créer STR depuis cette alerte
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* STR list */}
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-sm">Déclarations STR récentes</CardTitle></CardHeader>
            <CardContent>
              {strReports.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">Aucune STR soumise</p>
              ) : (
                <div className="space-y-2">
                  {strReports.map((s: any) => (
                    <div key={s.id} className="p-2 bg-primary/10 border border-primary/20 rounded text-xs">
                      <div className="font-bold text-primary">{s.ref}</div>
                      <div className="text-muted-foreground">{s.subject_name}</div>
                      <Badge className="text-xs mt-1 bg-primary/20 text-primary">Soumis CENTIF</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Regulatory indicators */}
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-sm">Indicateurs réglementaires</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              {[
                { label: "Tx ≥ 1M XOF à déclarer", value: transactions.filter((t: any) => Number(t.amount) >= 1_000_000).length, color: "text-accent" },
                { label: "Tx signalées", value: flaggedTx.length, color: "text-destructive" },
                { label: "Rapports AML générés", value: reports.filter((r: any) => r.report_type === "AML").length, color: "text-primary" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`font-bold ${color}`}>{value}</span>
                </div>
              ))}
              <div className="p-2 bg-secondary/30 rounded">
                <div className="text-muted-foreground mb-1">Seuil légal BCEAO</div>
                <div className="font-bold text-primary">1 000 000 XOF</div>
              </div>
            </CardContent>
          </Card>

          {/* Reference docs */}
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-sm">Textes de référence</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                "Règlement UEMOA N°14/2002/CM",
                "Loi uniforme LBC/FT BCEAO 2016",
                "Recommandations FATF/GAFI 2023",
                "Instructions CENTIF Sénégal 2020",
              ].map(doc => (
                <div key={doc} className="p-2 bg-secondary/30 rounded text-muted-foreground">{doc}</div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* STR Form Dialog */}
      {showSTR && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Déclaration de Soupçon (STR) — CENTIF</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowSTR(false)}>✕</Button>
              </div>
              <form onSubmit={submitSTR} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Nom du sujet *</Label>
                    <Input required value={strForm.subject_name} onChange={e => setStrForm(f => ({ ...f, subject_name: e.target.value }))} className="bg-secondary/50" placeholder="Prénom NOM" />
                  </div>
                  <div>
                    <Label>Compte/Numéro</Label>
                    <Input value={strForm.subject_account} onChange={e => setStrForm(f => ({ ...f, subject_account: e.target.value }))} className="bg-secondary/50" placeholder="ACC-0001" />
                  </div>
                  <div>
                    <Label>Montant (XOF)</Label>
                    <Input type="number" value={strForm.transaction_amount} onChange={e => setStrForm(f => ({ ...f, transaction_amount: e.target.value }))} className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>Date de la transaction</Label>
                    <Input type="date" value={strForm.transaction_date} onChange={e => setStrForm(f => ({ ...f, transaction_date: e.target.value }))} className="bg-secondary/50" />
                  </div>
                </div>
                <div>
                  <Label>Canal *</Label>
                  <Select value={strForm.transaction_channel} onValueChange={v => setStrForm(f => ({ ...f, transaction_channel: v }))}>
                    <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Bank", "MobileMoney", "Crypto", "P2P", "Virement", "Orange Money", "Wave"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Nature de l'opération suspecte *</Label>
                  <Input required value={strForm.suspicious_nature} onChange={e => setStrForm(f => ({ ...f, suspicious_nature: e.target.value }))} className="bg-secondary/50" placeholder="Ex: Smurfing — dépôts fractionnés récurrents" />
                </div>
                <div>
                  <Label>Narration d'investigation</Label>
                  <Textarea value={strForm.narrative} onChange={e => setStrForm(f => ({ ...f, narrative: e.target.value }))} className="bg-secondary/50 font-mono text-xs" rows={6} placeholder="Décrivez les faits, la chronologie et les éléments suspects..." />
                </div>
                <Button type="submit" className="w-full" disabled={createReport.isPending}>
                  {createReport.isPending ? "Soumission..." : "✅ Soumettre la déclaration STR à la CENTIF"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Users Management (RBAC) ----
function UsersManagement({ userRole }: { userRole?: AppRole | null }) {
  const { data: userRoles = [], isLoading, refetch: refetchRoles } = useAllUserRoles();
  const { data: invitations = [], refetch: refetchInvitations } = useOrgInvitations();
  const { data: myRole } = useUserRole();
  const { user: currentUser } = useAuth();
  const assignRole = useAssignRole();
  const revokeRole = useRevokeRole();
  const createInvitation = useCreateInvitation();
  const { toast } = useToast();
  const [inviteForm, setInviteForm] = useState({ email: "", role: "auditor" as AppRole });
  const [showInvite, setShowInvite] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: "", role: "auditor" as AppRole });
  const [showAssign, setShowAssign] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<{ userId: string; roles: string[] } | null>(null);
  const [changeRoleFor, setChangeRoleFor] = useState<{ userId: string; currentRole: string } | null>(null);
  const [newRole, setNewRole] = useState<AppRole>("auditor");
  const [usersTab, setUsersTab] = useState<"members" | "invitations" | "roles">("members");

  const isAdmin = myRole === "superadmin" || myRole === "org_admin";
  const isSuperadmin = myRole === "superadmin";

  const ROLE_COLORS: Record<string, string> = {
    superadmin: "text-destructive",
    org_admin: "text-accent",
    compliance_manager: "text-primary",
    analyst: "text-foreground",
    forensic_analyst: "text-foreground",
    auditor: "text-primary",
    read_only: "text-muted-foreground",
  };

  const ROLE_BADGES: Record<string, string> = {
    superadmin: "bg-destructive/15 text-destructive border-destructive/30",
    org_admin: "bg-accent/15 text-accent border-accent/30",
    compliance_manager: "bg-primary/15 text-primary border-primary/30",
    analyst: "bg-secondary text-foreground border-border",
    forensic_analyst: "bg-secondary text-foreground border-border",
    auditor: "bg-primary/10 text-primary border-primary/20",
    read_only: "bg-secondary/50 text-muted-foreground border-border",
  };

  const ROLE_DESCS: Record<string, string> = {
    superadmin: "Accès total, gestion infra",
    org_admin: "Gestion organisation et utilisateurs",
    compliance_manager: "Config règles, tableaux de bord, rapports",
    analyst: "Analyse transactions, investigations",
    forensic_analyst: "Analyses forensiques, exports signés",
    auditor: "Lecture/écriture audits, rapports",
    read_only: "Consultation uniquement",
  };

  // Group roles by user_id
  const userMap = userRoles.reduce((acc: Record<string, any[]>, ur: any) => {
    if (!acc[ur.user_id]) acc[ur.user_id] = [];
    acc[ur.user_id].push(ur);
    return acc;
  }, {});

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const inv = await createInvitation.mutateAsync(inviteForm);
      setInviteLink(null);
      setEmailSent(null);
      // Try to send the invitation email via edge function
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && inv?.id) {
          const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
          const res = await fetch(`https://${projectId}.supabase.co/functions/v1/send-invitation`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ invitationId: inv.id }),
          });
          const result = await res.json();
          if (result.activationUrl) setInviteLink(result.activationUrl);
          setEmailSent(result.emailSent || false);
          toast({
            title: result.emailSent ? "📧 Invitation envoyée par email" : "✅ Invitation créée",
            description: result.emailSent
              ? `Email d'activation envoyé à ${inviteForm.email}`
              : `Lien d'activation généré pour ${inviteForm.email}`,
          });
        }
      } catch {
        toast({ title: "✅ Invitation créée", description: `Invitation enregistrée pour ${inviteForm.email}` });
      }
      setShowInvite(false);
      setInviteForm({ email: "", role: "auditor" });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignForm.userId) return;
    try {
      await assignRole.mutateAsync({ userId: assignForm.userId, role: assignForm.role });
      toast({ title: `✅ Rôle ${assignForm.role} assigné avec succès` });
      setShowAssign(false);
      setAssignForm({ userId: "", role: "auditor" });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const handleChangeRole = async () => {
    if (!changeRoleFor) return;
    try {
      // Revoke old role then assign new one
      await revokeRole.mutateAsync({ userId: changeRoleFor.userId, role: changeRoleFor.currentRole as AppRole });
      await assignRole.mutateAsync({ userId: changeRoleFor.userId, role: newRole });
      toast({ title: `✅ Rôle changé vers ${newRole}` });
      setChangeRoleFor(null);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const handleDisableUser = async () => {
    if (!confirmDisable) return;
    try {
      // Assign read_only role (disable access by downgrading)
      await assignRole.mutateAsync({ userId: confirmDisable.userId, role: "read_only" });
      // Revoke all other roles
      for (const r of confirmDisable.roles.filter(r => r !== "read_only")) {
        await revokeRole.mutateAsync({ userId: confirmDisable.userId, role: r as AppRole });
      }
      toast({ title: "🔒 Compte restreint", description: "L'utilisateur a été rétrogradé en accès read_only." });
      setConfirmDisable(null);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const cancelInvitation = async (id: string) => {
    try {
      await supabase.from("org_invitations").update({ status: "cancelled" }).eq("id", id);
      toast({ title: "Invitation annulée" });
      refetchInvitations();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const pendingInvitations = invitations.filter((i: any) => i.status === "pending");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Gestion des utilisateurs
          </h2>
          <p className="text-sm text-muted-foreground mt-1">RBAC — Contrôle d'accès basé sur les rôles · {Object.keys(userMap).length} membres</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {isSuperadmin && (
              <Dialog open={showAssign} onOpenChange={setShowAssign}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary" className="gap-2"><Shield className="h-4 w-4" /> Assigner rôle</Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-border">
                  <DialogHeader><DialogTitle>Assigner un rôle à un utilisateur existant</DialogTitle></DialogHeader>
                  <form onSubmit={handleAssignRole} className="space-y-4">
                    <div>
                      <Label>User ID (UUID) *</Label>
                      <Input required value={assignForm.userId} onChange={e => setAssignForm(f => ({ ...f, userId: e.target.value }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="bg-secondary/50 font-mono text-xs" />
                      <p className="text-xs text-muted-foreground mt-1">Copier l'UUID depuis la liste des membres ci-dessous</p>
                    </div>
                    <div>
                      <Label>Rôle</Label>
                      <Select value={assignForm.role} onValueChange={v => setAssignForm(f => ({ ...f, role: v as AppRole }))}>
                        <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(ROLE_DESCS).map(([role, desc]) => (
                            <SelectItem key={role} value={role}>{role} — {desc}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full" disabled={assignRole.isPending}>
                      {assignRole.isPending ? "Assignation..." : "Assigner le rôle"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
            <Dialog open={showInvite} onOpenChange={setShowInvite}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Inviter un membre</Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>Inviter un utilisateur</DialogTitle></DialogHeader>
                <form onSubmit={handleInvite} className="space-y-4">
                  <div>
                    <Label>Email *</Label>
                    <Input required type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="email@organisation.com" className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>Rôle assigné</Label>
                    <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v as AppRole }))}>
                      <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_DESCS).map(([role, desc]) => (
                          <SelectItem key={role} value={role}>{role} — {desc}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{ROLE_DESCS[inviteForm.role]}</p>
                  </div>
                   <Button type="submit" className="w-full" disabled={createInvitation.isPending}>
                    {createInvitation.isPending ? <><RefreshCw className="h-4 w-4 animate-spin inline mr-2" />Envoi...</> : "Créer & envoyer l'invitation"}
                  </Button>
                </form>
                {inviteLink && (
                  <div className="mt-3 p-3 bg-primary/10 border border-primary/20 rounded-lg space-y-1">
                    <div className="flex items-center gap-2">
                      {emailSent
                        ? <span className="text-xs font-medium text-primary">📧 Email envoyé</span>
                        : <span className="text-xs font-medium text-accent">🔗 Lien d'activation généré</span>}
                    </div>
                    <p className="text-xs text-muted-foreground break-all font-mono select-all">{inviteLink}</p>
                    <Button size="sm" variant="outline" className="h-6 text-xs w-full"
                      onClick={() => { navigator.clipboard.writeText(inviteLink); toast({ title: "Lien copié !" }); }}>
                      Copier le lien
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg w-fit">
        {[
          { key: "members" as const, label: `Membres (${Object.keys(userMap).length})` },
          { key: "invitations" as const, label: `Invitations (${pendingInvitations.length})` },
          { key: "roles" as const, label: "Matrice des rôles" },
        ].map(t => (
          <button key={t.key} onClick={() => setUsersTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${usersTab === t.key ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Members tab */}
      {usersTab === "members" && (
        <Card className="bg-card/50 border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-6 text-center">Chargement...</div>
            ) : Object.keys(userMap).length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Aucun utilisateur enregistré</div>
            ) : (
              <div className="divide-y divide-border">
                {Object.entries(userMap).map(([uid, roles]: [string, any[]]) => {
                  const isCurrentUser = uid === currentUser?.id;
                  const primaryRole = roles[0]?.role || "auditor";
                  const isDisabled = roles.length === 1 && primaryRole === "read_only";
                  return (
                    <div key={uid} className={`flex items-center gap-4 p-4 hover:bg-secondary/20 transition-colors ${isDisabled ? "opacity-60" : ""}`}>
                      <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {roles.map((ur: any) => (
                            <span key={ur.id} className={`text-xs font-medium px-2 py-0.5 rounded border ${ROLE_BADGES[ur.role] || ""}`}>{ur.role}</span>
                          ))}
                          {isCurrentUser && <Badge variant="outline" className="text-xs text-muted-foreground">Vous</Badge>}
                          {isDisabled && <Badge variant="outline" className="text-xs text-muted-foreground">Restreint</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-1 select-all cursor-text" title="Cliquer pour sélectionner l'UUID">
                          {uid}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Depuis le {new Date(roles[0]?.assigned_at).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                      {isAdmin && !isCurrentUser && primaryRole !== "superadmin" && (
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Change role */}
                          <Dialog open={changeRoleFor?.userId === uid} onOpenChange={open => { if (!open) setChangeRoleFor(null); }}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                                onClick={() => { setChangeRoleFor({ userId: uid, currentRole: primaryRole }); setNewRole(primaryRole as AppRole); }}>
                                <Shield className="h-3 w-3" /> Changer rôle
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-card border-border max-w-sm">
                              <DialogHeader><DialogTitle>Changer le rôle</DialogTitle></DialogHeader>
                              <div className="space-y-3">
                                <p className="text-xs text-muted-foreground">Rôle actuel : <strong className={ROLE_COLORS[primaryRole]}>{primaryRole}</strong></p>
                                <Select value={newRole} onValueChange={v => setNewRole(v as AppRole)}>
                                  <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(ROLE_DESCS).filter(([r]) => r !== "superadmin" || isSuperadmin).map(([role, desc]) => (
                                      <SelectItem key={role} value={role}>{role} — {desc}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button className="w-full" onClick={handleChangeRole} disabled={assignRole.isPending || revokeRole.isPending}>
                                  {assignRole.isPending ? "En cours..." : "Confirmer le changement"}
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                          {/* Disable / revoke */}
                          {!isDisabled ? (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                              onClick={() => setConfirmDisable({ userId: uid, roles: roles.map((r: any) => r.role) })}>
                              <XCircle className="h-3 w-3" /> Désactiver
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                              onClick={async () => {
                                try {
                                  await assignRole.mutateAsync({ userId: uid, role: "auditor" });
                                  await revokeRole.mutateAsync({ userId: uid, role: "read_only" });
                                  toast({ title: "✅ Compte réactivé en auditor" });
                                } catch (e: any) { toast({ title: "Erreur", description: e.message, variant: "destructive" }); }
                              }}>
                              <CheckCircle2 className="h-3 w-3" /> Réactiver
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invitations tab */}
      {usersTab === "invitations" && (
        <Card className="bg-card/50 border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Invitations ({pendingInvitations.length} en attente)</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingInvitations.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Aucune invitation en attente
              </div>
            ) : (
              <div className="space-y-2">
                {pendingInvitations.map((inv: any) => {
                  const isExpired = new Date(inv.expires_at) < new Date();
                  return (
                    <div key={inv.id} className={`p-3 bg-secondary/30 rounded-lg border ${isExpired ? "border-destructive/20 opacity-70" : "border-transparent"}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{inv.email}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${ROLE_BADGES[inv.role] || ""}`}>{inv.role}</span>
                            <span className="text-xs text-muted-foreground">
                              {isExpired ? "⚠ Expiré le" : "Expire le"} {new Date(inv.expires_at).toLocaleDateString("fr-FR")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${isExpired ? "border-destructive/30 text-destructive" : ""}`}>
                            {isExpired ? "Expiré" : "En attente"}
                          </Badge>
                          {isAdmin && !isExpired && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                              onClick={async () => {
                                try {
                                  const { data: { session } } = await supabase.auth.getSession();
                                  if (!session) return;
                                  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
                                  const res = await fetch(`https://${projectId}.supabase.co/functions/v1/send-invitation`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                                    body: JSON.stringify({ invitationId: inv.id }),
                                  });
                                  const result = await res.json();
                                  if (result.activationUrl) {
                                    navigator.clipboard.writeText(result.activationUrl);
                                    toast({
                                      title: result.emailSent ? "📧 Email renvoyé" : "🔗 Lien copié",
                                      description: result.emailSent ? `Email envoyé à ${inv.email}` : "Lien d'activation copié dans le presse-papiers",
                                    });
                                  }
                                } catch (e: any) {
                                  toast({ title: "Erreur", description: e.message, variant: "destructive" });
                                }
                              }}>
                              📧 Renvoyer
                            </Button>
                          )}
                          {isAdmin && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                              onClick={() => cancelInvitation(inv.id)}>
                              Annuler
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {invitations.filter((i: any) => i.status !== "pending").length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground font-semibold mb-2">Historique</div>
                <div className="space-y-1">
                  {invitations.filter((i: any) => i.status !== "pending").slice(0, 8).map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between p-2 rounded text-xs text-muted-foreground bg-secondary/20">
                      <span className="truncate flex-1">{inv.email}</span>
                      <span className={`text-xs font-medium ml-2 ${ROLE_BADGES[inv.role] || ""} px-1.5 py-0.5 rounded border`}>{inv.role}</span>
                      <span className={`ml-2 ${inv.status === "accepted" ? "text-primary" : inv.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}`}>
                        {inv.status === "accepted" ? "✓ Accepté" : inv.status === "cancelled" ? "Annulé" : inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Roles matrix tab */}
      {usersTab === "roles" && (
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">Matrice des rôles & Permissions</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(ROLE_DESCS).map(([role, desc]) => {
                const count = Object.entries(userMap).filter(([, roles]) => (roles as any[]).some((r: any) => r.role === role)).length;
                return (
                  <div key={role} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-semibold px-2 py-0.5 rounded border ${ROLE_BADGES[role] || ""}`}>{role}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {count > 0 && <Badge variant="secondary" className="text-xs">{count} membre{count > 1 ? "s" : ""}</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Disable confirmation modal */}
      {confirmDisable && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmDisable(null)}>
          <Card className="w-full max-w-sm bg-card border-border shadow-2xl" onClick={e => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base text-destructive flex items-center gap-2"><XCircle className="h-5 w-5" /> Désactiver le compte</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Cela rétrogradera l'utilisateur en <strong>read_only</strong> et révoquera tous ses rôles actifs. Il pourra encore se connecter mais ne pourra plus effectuer d'actions.
              </p>
              <div className="p-2 bg-secondary/30 rounded text-xs font-mono break-all">{confirmDisable.userId}</div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmDisable(null)}>Annuler</Button>
                <Button
                  className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={handleDisableUser}
                  disabled={assignRole.isPending || revokeRole.isPending}
                >
                  {assignRole.isPending ? "En cours..." : "Désactiver"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---- AML Performance Dashboard (30 days) ----
function AMLPerformanceDashboard() {
  const { data: transactions = [] } = useTransactions();
  const { data: alerts = [] } = useAlerts();
  const { data: reports = [] } = useReports();

  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recentTx = transactions.filter((t: any) => new Date(t.date) >= cutoff30);
  const recentAlerts = alerts.filter((a: any) => new Date(a.created_at) >= cutoff30);
  const recentSTR = reports.filter((r: any) => r.report_type === "STR" && new Date(r.created_at) >= cutoff30);

  // --- 30-day daily avg AML score sparkline ---
  const dailyScores: Record<string, number[]> = {};
  recentTx.forEach((t: any) => {
    const day = t.date?.slice(0, 10) || "";
    if (!dailyScores[day]) dailyScores[day] = [];
    const s = computeAMLScore(t, transactions).score;
    dailyScores[day].push(s);
  });
  const scoreSparkline = Object.entries(dailyScores)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({
      date: date.slice(5),
      avgScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      maxScore: Math.max(...scores),
    }));

  // --- Weekly STR count ---
  const weeklySTR: Record<string, number> = {};
  for (let i = 3; i >= 0; i--) {
    const wStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const wEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const label = `S-${i === 0 ? "Actuelle" : i}`;
    weeklySTR[label] = recentSTR.filter((r: any) => {
      const d = new Date(r.created_at);
      return d >= wStart && d < wEnd;
    }).length;
  }
  const strWeeklyData = Object.entries(weeklySTR).map(([week, count]) => ({ week, count }));

  // --- Weekly alert count ---
  const weeklyAlerts: Record<string, { high: number; medium: number }> = {};
  for (let i = 3; i >= 0; i--) {
    const wStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const wEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const label = `S-${i === 0 ? "Act" : i}`;
    const wAlerts = recentAlerts.filter((a: any) => {
      const d = new Date(a.created_at);
      return d >= wStart && d < wEnd;
    });
    weeklyAlerts[label] = {
      high: wAlerts.filter((a: any) => a.severity === "high").length,
      medium: wAlerts.filter((a: any) => a.severity === "medium").length,
    };
  }
  const alertWeeklyData = Object.entries(weeklyAlerts).map(([week, v]) => ({ week, ...v }));

  // --- BCEAO compliance rate (from localStorage) ---
  const BCEAO_ITEMS_KEYS = [
    "KYC::Identification et vérification de l'identité des clients",
    "KYC::Vérification des bénéficiaires effectifs",
    "KYC::Évaluation du profil de risque client",
    "KYC::Mise à jour périodique des dossiers clients (tous les 3 ans)",
    "Surveillance::Surveillance continue des transactions",
    "Surveillance::Détection automatique des opérations suspectes",
    "Surveillance::Seuil de déclaration: transactions ≥ 1 000 000 XOF",
    "Surveillance::Contrôle des virements internationaux",
    "Déclaration::Procédure de déclaration de soupçon (DS) à la CENTIF",
    "Déclaration::Délai de déclaration: 24h après détection",
    "Déclaration::Conservation des dossiers: 10 ans minimum",
    "Déclaration::Formation du personnel sur les typologies AML",
    "Gouvernance::Désignation d'un Responsable LBC/FT",
    "Gouvernance::Politique LBC/FT approuvée par la direction",
    "Gouvernance::Audit interne annuel LBC/FT",
    "Gouvernance::Rapport annuel de conformité",
  ];
  const savedChecklist = (() => {
    try { return JSON.parse(localStorage.getItem("bceao_checklist") || "{}"); } catch { return {}; }
  })();
  const completedItems = BCEAO_ITEMS_KEYS.filter(k => savedChecklist[k]).length;
  const complianceRate = Math.round((completedItems / BCEAO_ITEMS_KEYS.length) * 100);

  // KPIs
  const avgScoreAll = recentTx.length > 0
    ? Math.round(recentTx.reduce((s: number, t: any) => s + computeAMLScore(t, transactions).score, 0) / recentTx.length)
    : 0;
  const criticalTx = recentTx.filter((t: any) => computeAMLScore(t, transactions).score >= 70).length;

  const COLORS = {
    accent: "hsl(var(--accent))",
    primary: "hsl(var(--primary))",
    destructive: "hsl(var(--destructive))",
    muted: "hsl(var(--muted-foreground))",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" /> Performance AML — 30 derniers jours
          </h2>
          <p className="text-sm text-muted-foreground">Évolution du risque · STR hebdomadaires · Conformité BCEAO</p>
        </div>
        <Badge variant="secondary" className="text-xs">{now.toLocaleDateString("fr-FR")} · 30j</Badge>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <StatsCard title="Transactions 30j" value={recentTx.length.toString()} />
        <StatsCard title="Score AML moyen" value={`${avgScoreAll}/100`} warning={avgScoreAll > 30} danger={avgScoreAll > 60} />
        <StatsCard title="Cas critiques" value={criticalTx.toString()} danger={criticalTx > 0} />
        <StatsCard title="Alertes haute sévérité" value={recentAlerts.filter((a: any) => a.severity === "high").length.toString()} danger />
        <StatsCard title="Conformité BCEAO" value={`${complianceRate}%`} warning={complianceRate < 75} danger={complianceRate < 50} />
      </div>

      <div className="grid grid-cols-12 gap-5 mb-5">
        {/* Score trend sparkline */}
        <Card className="col-span-8 bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Évolution du score AML moyen (30j)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scoreSparkline.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Aucune donnée sur 30 jours</div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={scoreSparkline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any, name: string) => [v, name === "avgScore" ? "Score moyen" : "Score max"]}
                    />
                    <Legend formatter={(v) => v === "avgScore" ? "Score moyen" : "Score max"} />
                    <Line type="monotone" dataKey="avgScore" stroke={COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="maxScore" stroke={COLORS.destructive} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Compliance gauge */}
        <Card className="col-span-4 bg-card/50 border-border flex flex-col items-center justify-center p-6">
          <div className="text-sm font-semibold text-muted-foreground mb-3">Taux conformité BCEAO</div>
          <div className="relative flex items-center justify-center mb-3">
            {(() => {
              const r = 44;
              const circ = 2 * Math.PI * r;
              const dash = (complianceRate / 100) * circ;
              const color = complianceRate >= 75 ? "hsl(var(--primary))" : complianceRate >= 50 ? "hsl(var(--accent))" : "hsl(var(--destructive))";
              return (
                <svg width={110} height={110} style={{ transform: "rotate(-90deg)" }}>
                  <circle cx={55} cy={55} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={10} />
                  <circle cx={55} cy={55} r={r} fill="none" stroke={color} strokeWidth={10}
                    strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                    style={{ transition: "stroke-dasharray 0.8s ease" }}
                  />
                </svg>
              );
            })()}
            <div className="absolute text-center">
              <div className={`text-2xl font-black ${complianceRate >= 75 ? "text-primary" : complianceRate >= 50 ? "text-accent" : "text-destructive"}`}>
                {complianceRate}%
              </div>
              <div className="text-xs text-muted-foreground">{completedItems}/{BCEAO_ITEMS_KEYS.length}</div>
            </div>
          </div>
          <div className="text-xs text-center">
            {complianceRate >= 75 ? "✅ Conforme BCEAO" : complianceRate >= 50 ? "⚠️ Attention requise" : "🚨 Non conforme"}
          </div>
          <div className="mt-4 w-full space-y-1.5">
            {[
              { cat: "KYC", keys: BCEAO_ITEMS_KEYS.slice(0, 4) },
              { cat: "Surveillance", keys: BCEAO_ITEMS_KEYS.slice(4, 8) },
              { cat: "Déclaration", keys: BCEAO_ITEMS_KEYS.slice(8, 12) },
              { cat: "Gouvernance", keys: BCEAO_ITEMS_KEYS.slice(12, 16) },
            ].map(({ cat, keys }) => {
              const done = keys.filter(k => savedChecklist[k]).length;
              const pct = Math.round((done / keys.length) * 100);
              const colors: Record<string, string> = { KYC: "bg-primary", Surveillance: "bg-accent", Déclaration: "bg-green-500", Gouvernance: "bg-amber-500" };
              return (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-muted-foreground">{cat}</span>
                    <span className="font-medium">{done}/{keys.length}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${colors[cat] || "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* STR per week */}
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              Déclarations STR par semaine
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={strWeeklyData} barCategoryGap="40%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="count" name="STR soumises" fill={COLORS.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {recentSTR.length === 0 && (
              <p className="text-xs text-center text-muted-foreground mt-2">Aucune STR soumise sur 30 jours</p>
            )}
          </CardContent>
        </Card>

        {/* Alerts per week */}
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Alertes par sévérité (semaines)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={alertWeeklyData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="high" name="Haute" fill={COLORS.destructive} radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="medium" name="Moyenne" fill={COLORS.accent} radius={[4, 4, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Helpers ----
function StatsCard({ title, value, danger, warning }: { title: string; value: string; danger?: boolean; warning?: boolean }) {
  return (
    <Card className="bg-card/50 border-border">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-1">{title}</div>
        <div className={`text-xl font-bold ${danger ? "text-destructive" : warning ? "text-accent" : "text-foreground"}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function formatCurrency(v: number) {
  if (v == null) return "0 FCFA";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XOF" }).format(v);
}

// ---- Weekly AML Report ----
function WeeklyAMLReport() {
  const { toast } = useToast();
  const { data: profile } = useProfile();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const generateReport = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/weekly-aml-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur IA");
      setReport(data);
      toast({ title: "✅ Rapport généré et sauvegardé dans Rapports" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = async () => {
    if (!report) return;
    setExportingPdf(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 18;
      const contentW = pageW - margin * 2;

      // ── Header bar ──
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 30, "F");

      // Load & embed logo
      try {
        const logoResp = await fetch(logo);
        if (logoResp.ok) {
          const logoBlob = await logoResp.blob();
          const reader = new FileReader();
          const logoB64: string = await new Promise(res => { reader.onload = () => res(reader.result as string); reader.readAsDataURL(logoBlob); });
          doc.addImage(logoB64, "PNG", margin, 5, 20, 20);
        }
      } catch {}

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      doc.text("DeepAuditAI — Rapport Hebdomadaire AML", margin + 25, 14);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184);
      doc.text("L'Œil de la Traçabilité · Zone UEMOA/BCEAO", margin + 25, 21);
      if (profile?.organization) {
        doc.text(profile.organization, pageW - margin, 21, { align: "right" });
      }

      // ── Sub-header ──
      doc.setFillColor(30, 41, 59);
      doc.rect(0, 30, pageW, 12, "F");
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(8.5);
      doc.text(`Période : ${report.period?.from} → ${report.period?.to}`, margin, 37.5);
      const genDate = new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      doc.text(`Généré le ${genDate}`, pageW - margin, 37.5, { align: "right" });

      // ── Declarant info bar ──
      const declarant = profile?.full_name || "N/A";
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 42, pageW, 9, "F");
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7.5);
      doc.text(`Déclarant : ${declarant}`, margin, 47.5);
      const totalVol = report.stats?.totalAmount != null
        ? `Volume total : ${Number(report.stats.totalAmount).toLocaleString("fr-FR")} XOF`
        : "";
      if (totalVol) doc.text(totalVol, pageW / 2, 47.5, { align: "center" });
      doc.text(`Haute sévérité : ${report.stats?.highAlerts ?? 0} alertes`, pageW - margin, 47.5, { align: "right" });

      // ── KPI boxes (row 1: 3 boxes) ──
      const kpiRow1 = [
        { label: "Transactions analysées", value: String(report.stats?.totalTx ?? 0), red: false },
        { label: "Transactions signalées", value: String(report.stats?.flaggedTx ?? 0), red: (report.stats?.flaggedTx ?? 0) > 0 },
        { label: "Alertes ouvertes", value: String(report.stats?.openAlerts ?? 0), red: (report.stats?.openAlerts ?? 0) > 0 },
      ];
      const kpiRow2 = [
        { label: "STR soumises CENTIF", value: String(report.stats?.strCount ?? 0), red: false },
        { label: "Tx critiques (≥5M XOF)", value: String(report.stats?.criticalTx ?? 0), red: (report.stats?.criticalTx ?? 0) > 0 },
        { label: "Conformité BCEAO", value: `${report.stats?.complianceRate ?? 0}%`, red: (report.stats?.complianceRate ?? 100) < 50 },
      ];
      const kpiBoxW = contentW / 3;
      const drawKpiRow = (kpis: typeof kpiRow1, startY: number) => {
        kpis.forEach((k, i) => {
          const x = margin + i * kpiBoxW;
          doc.setFillColor(k.red ? 100 : 22, k.red ? 27 : 33, k.red ? 35 : 51);
          doc.roundedRect(x, startY, kpiBoxW - 2, 17, 2, 2, "F");
          if (k.red) {
            doc.setDrawColor(239, 68, 68);
            doc.setLineWidth(0.3);
            doc.roundedRect(x, startY, kpiBoxW - 2, 17, 2, 2, "S");
          }
          doc.setTextColor(148, 163, 184);
          doc.setFontSize(6.5);
          doc.setFont("helvetica", "normal");
          doc.text(k.label, x + (kpiBoxW - 2) / 2, startY + 5.5, { align: "center" });
          doc.setTextColor(k.red ? 252 : 226, k.red ? 165 : 232, k.red ? 165 : 240);
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(k.value, x + (kpiBoxW - 2) / 2, startY + 13, { align: "center" });
        });
      };
      drawKpiRow(kpiRow1, 55);
      drawKpiRow(kpiRow2, 75);

      // ── Separator ──
      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(0.5);
      doc.line(margin, 96, pageW - margin, 96);

      // ── Report content ──
      let y = 101;
      const lineHeight = 5.5;
      const reportText: string = report.report || "";
      const lines = reportText.split("\n");

      for (const rawLine of lines) {
        if (y > pageH - 20) {
          doc.addPage();
          y = margin;
        }
        const line = rawLine.trim();
        if (!line) { y += 2.5; continue; }

        if (line.startsWith("### ") || (line.startsWith("**") && line.endsWith("**") && line.length < 60)) {
          y += 2;
          doc.setFillColor(22, 33, 51);
          doc.rect(margin - 2, y - 4.5, contentW + 4, 8, "F");
          doc.setDrawColor(59, 130, 246);
          doc.setLineWidth(0.4);
          doc.line(margin - 2, y - 4.5, margin - 2, y + 3.5);
          doc.setTextColor(99, 179, 237);
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          const clean = line.replace(/^###\s*\d*\.\s*/, "").replace(/\*\*/g, "");
          doc.text(clean, margin + 2, y + 1);
          y += 9;
        } else if (line.startsWith("## ")) {
          y += 3;
          doc.setTextColor(147, 197, 253);
          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.text(line.replace(/^##\s*/, ""), margin, y);
          y += 7;
        } else if (line.startsWith("# ")) {
          y += 4;
          doc.setTextColor(186, 230, 253);
          doc.setFontSize(13);
          doc.setFont("helvetica", "bold");
          doc.text(line.replace(/^#\s*/, ""), margin, y);
          y += 8;
        } else {
          doc.setTextColor(203, 213, 225);
          doc.setFontSize(8.5);
          doc.setFont("helvetica", "normal");
          const clean = line.replace(/\*\*/g, "").replace(/^\*\s*/, "• ").replace(/^-\s+/, "• ");
          const wrapped = doc.splitTextToSize(clean, contentW);
          for (const wl of wrapped) {
            if (y > pageH - 20) { doc.addPage(); y = margin; }
            doc.text(wl, margin, y);
            y += lineHeight;
          }
        }
      }

      // ── Signature block on last page ──
      if (y + 30 > pageH - 20) { doc.addPage(); y = margin; }
      y += 8;
      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageW - margin, y);
      y += 6;
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "italic");
      doc.text(`Rapport certifié par DeepAuditAI — Confidentiel — Usage interne uniquement`, margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.text(`Déclarant : ${declarant}${profile?.organization ? ` · ${profile.organization}` : ""}`, margin, y);
      doc.text(`Date de génération : ${genDate}`, pageW - margin, y, { align: "right" });

      // ── Footer on each page ──
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFillColor(15, 23, 42);
        doc.rect(0, pageH - 12, pageW, 12, "F");
        doc.setTextColor(71, 85, 105);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(`DeepAuditAI · Rapport AML Confidentiel · ${report.period?.from} → ${report.period?.to}`, margin, pageH - 4.5);
        doc.text(`Page ${p}/${totalPages}`, pageW - margin, pageH - 4.5, { align: "right" });
        if (profile?.organization) {
          doc.text(profile.organization, pageW / 2, pageH - 4.5, { align: "center" });
        }
      }

      doc.save(`Rapport_AML_${report.period?.from}_${report.period?.to}.pdf`);
      toast({ title: "📄 PDF exporté avec succès", description: "Rapport complet avec KPIs, analyse IA et signature" });
    } catch (e: any) {
      toast({ title: "Erreur export PDF", description: e.message, variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Rapport Hebdomadaire AML
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Synthèse IA des 7 derniers jours · Auto-sauvegardée · Planifiée chaque lundi 08h00 UTC
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <Button
              variant="outline"
              onClick={exportPDF}
              disabled={exportingPdf}
              className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              {exportingPdf ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {exportingPdf ? "Export..." : "Exporter PDF"}
            </Button>
          )}
          <Button onClick={generateReport} disabled={loading} className="gap-2">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {loading ? "Génération en cours..." : "Générer le rapport"}
          </Button>
        </div>
      </div>

      {!report && !loading && (
        <Card className="bg-card/50 border-dashed border-border">
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">Aucun rapport généré</p>
            <p className="text-muted-foreground/70 text-sm mt-1">Cliquez sur "Générer le rapport" pour créer une synthèse IA de la semaine</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card className="bg-card/50 border-border">
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Analyse Gemini en cours...</p>
          </CardContent>
        </Card>
      )}

      {report && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Transactions", value: report.stats?.totalTx ?? 0, danger: false },
              { label: "Signalées", value: report.stats?.flaggedTx ?? 0, danger: (report.stats?.flaggedTx ?? 0) > 0 },
              { label: "Alertes ouvertes", value: report.stats?.openAlerts ?? 0, danger: (report.stats?.openAlerts ?? 0) > 0 },
              { label: "STR soumises", value: report.stats?.strCount ?? 0, danger: false },
              { label: "Conformité BCEAO", value: `${report.stats?.complianceRate ?? 0}%`, danger: (report.stats?.complianceRate ?? 100) < 50 },
            ].map(s => (
              <StatsCard key={s.label} title={s.label} value={s.value.toString()} danger={s.danger} />
            ))}
          </div>
          <Card className="bg-card/50 border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Rapport — Semaine du {report.period?.from} au {report.period?.to}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={exportPDF}
                disabled={exportingPdf}
                className="gap-1.5 h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
              >
                {exportingPdf ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                {exportingPdf ? "Export..." : "PDF signé"}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                {report.report}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

// ---- Executive Dashboard (Superadmin / Org Admin) ----
function ExecutiveDashboard({ userRole }: { userRole?: string | null }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const canAccess = ["superadmin", "org_admin"].includes(userRole || "");

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/executive-dashboard`, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Erreur");
      setData(result);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canAccess) fetchDashboard(); }, [canAccess]);

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Shield className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground font-medium">{t("exec.access_denied")}</p>
        <p className="text-sm text-muted-foreground/70">{t("exec.role_required")}</p>
      </div>
    );
  }

  const COLORS_CHART = [
    "hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--destructive))",
    "hsl(var(--muted-foreground))", "#10b981", "#f59e0b",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            {t("exec.title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("exec.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDashboard} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("exec.refresh")}
        </Button>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-8 w-8 text-primary animate-spin" />
        </div>
      )}

      {data && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Global KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: t("exec.active_users"), value: data.globalStats.totalUsers, icon: Users, color: "text-primary" },
              { label: t("exec.total_tx"), value: data.globalStats.totalTransactions, icon: Activity, color: "text-foreground" },
              { label: t("exec.open_alerts"), value: data.globalStats.openAlerts, icon: AlertTriangle, color: "text-destructive", danger: data.globalStats.openAlerts > 0 },
              { label: t("exec.submitted_str"), value: data.globalStats.submittedSTR, icon: FileText, color: "text-accent" },
            ].map(kpi => (
              <Card key={kpi.label} className={`bg-card/50 border-border ${kpi.danger ? "border-destructive/30" : ""}`}>
                <CardContent className="p-4 flex items-center gap-3">
                  <kpi.icon className={`h-8 w-8 ${kpi.color} opacity-80`} />
                  <div>
                    <div className="text-2xl font-bold text-foreground">{kpi.value.toLocaleString("fr-FR")}</div>
                    <div className="text-xs text-muted-foreground">{kpi.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Extended KPIs row */}
          <div className="grid grid-cols-5 gap-3">
            <StatsCard title={t("exec.tx_this_week")} value={data.globalStats.totalTransactions7d.toString()} />
            <StatsCard title={t("exec.flagged_tx")} value={data.globalStats.totalFlagged.toString()} danger={data.globalStats.totalFlagged > 0} />
            <StatsCard title={t("exec.high_sev_alerts")} value={data.globalStats.highAlerts.toString()} danger={data.globalStats.highAlerts > 0} />
            <StatsCard title={t("exec.critical_dossiers")} value={data.globalStats.criticalDossiers.toString()} danger={data.globalStats.criticalDossiers > 0} />
            <StatsCard title={t("exec.pending_str")} value={data.globalStats.pendingSTR.toString()} warning={data.globalStats.pendingSTR > 0} />
          </div>

          <div className="grid grid-cols-12 gap-5">
            {/* Weekly trend */}
            <Card className="col-span-8 bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  {t("exec.weekly_trend")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="txCount" name="Transactions" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="left" dataKey="flagged" name="Signalées" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="volume" name="Volume (MXOF)" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Channel distribution */}
            <Card className="col-span-4 bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="h-4 w-4 text-accent" />
                  {t("exec.channels")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={Object.entries(data.channelDist).map(([name, value]) => ({ name, value }))}
                        cx="50%" cy="50%" outerRadius={75} innerRadius={35}
                        dataKey="value" nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {Object.keys(data.channelDist).map((_: string, i: number) => (
                          <Cell key={i} fill={COLORS_CHART[i % COLORS_CHART.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Org compliance ranking */}
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                {t("exec.compliance_ranking")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.orgBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("exec.no_profiles")}</p>
              ) : (
                <div className="space-y-2">
                  {data.orgBreakdown.map((org: any, i: number) => (
                    <div key={org.userId} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/20 hover:bg-secondary/40 transition-colors">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? "bg-yellow-500/20 text-yellow-500" : i === 1 ? "bg-slate-400/20 text-slate-400" : i === 2 ? "bg-amber-700/20 text-amber-700" : "bg-secondary text-muted-foreground"}`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-foreground truncate">{org.name}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{org.organization}</Badge>
                          <Badge variant="secondary" className="text-xs shrink-0">{org.role}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${org.complianceScore >= 75 ? "bg-primary" : org.complianceScore >= 50 ? "bg-accent" : "bg-destructive"}`}
                              style={{ width: `${org.complianceScore}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold w-12 text-right ${org.complianceScore >= 75 ? "text-primary" : org.complianceScore >= 50 ? "text-accent" : "text-destructive"}`}>
                            {org.complianceScore}%
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground shrink-0">
                        <span>{org.txCount} tx</span>
                        {org.flaggedCount > 0 && <span className="text-destructive">⚠ {org.flaggedCount}</span>}
                        {org.strCount > 0 && <span className="text-accent">📄 {org.strCount} STR</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Critical cross-org alerts */}
          {data.criticalAlerts.length > 0 && (
            <Card className="bg-destructive/5 border-destructive/20">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertOctagon className="h-4 w-4" />
                  {t("exec.critical_cross_org")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.criticalAlerts.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-3 p-2 rounded bg-destructive/10 border border-destructive/20 text-sm">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="font-medium text-foreground flex-1">{a.title}</span>
                      <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">{a.userOrg}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString("fr-FR")}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ---- STR Approval Workflow ----
function STRApprovalWorkflow({ userRole }: { userRole?: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: strReports = [], isLoading, refetch } = useQuery({
    queryKey: ["str_reports_workflow"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("str_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const [selectedSTR, setSelectedSTR] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [creatingTest, setCreatingTest] = useState(false);
  const [showTestForm, setShowTestForm] = useState(false);
  const [testForm, setTestForm] = useState({
    subject_name: "Diallo Oumar",
    subject_account: "CI-5400-0012349",
    transaction_amount: "7500000",
    transaction_channel: "Mobile Money",
    transaction_date: new Date().toISOString().slice(0, 10),
    suspicious_nature: "Fractionnement suspect · 3 virements successifs en 24h",
    narrative: "Transaction analysée par DeepAuditAI — score AML élevé · typologies: structuring, rapid_movement",
  });

  const canApprove = ["superadmin", "org_admin", "compliance_manager"].includes(userRole || "");

  const createTestSTR = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingTest(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");
      const { error } = await supabase.from("str_reports").insert({
        user_id: user.id,
        subject_name: testForm.subject_name,
        subject_account: testForm.subject_account,
        transaction_amount: Number(testForm.transaction_amount),
        transaction_channel: testForm.transaction_channel,
        transaction_date: testForm.transaction_date,
        suspicious_nature: testForm.suspicious_nature,
        narrative: testForm.narrative,
        status: "draft",
      });
      if (error) throw error;
      toast({ title: "✅ STR de test créé en brouillon", description: "Utilisez 'Envoyer en revue' pour passer en pending_approval, puis approuver." });
      setShowTestForm(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setCreatingTest(false);
    }
  };

  const updateSTRStatus = async (id: string, status: "submitted" | "rejected", note?: string) => {
    setUpdating(true);
    try {
      const updates: any = { status, updated_at: new Date().toISOString() };
      if (status === "submitted") {
        updates.submitted_at = new Date().toISOString();
        if (note) updates.narrative = (selectedSTR?.narrative || "") + `\n\n[Validation ${new Date().toLocaleDateString("fr-FR")}]: ${note}`;
      } else if (note) {
        updates.narrative = (selectedSTR?.narrative || "") + `\n\n[Rejet ${new Date().toLocaleDateString("fr-FR")}]: ${note}`;
      }
      const { error } = await supabase.from("str_reports").update(updates).eq("id", id);
      if (error) throw error;
      toast({
        title: status === "submitted" ? "✅ STR soumise à la CENTIF" : "❌ STR rejetée",
        description: status === "submitted" ? "La déclaration a été validée et soumise." : "La déclaration a été rejetée et retournée à l'analyste.",
      });
      setSelectedSTR(null);
      setReviewNote("");
      refetch();
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    draft: { label: "Brouillon", color: "text-muted-foreground", bg: "bg-secondary/50" },
    pending_approval: { label: "En attente d'approbation", color: "text-accent", bg: "bg-accent/10" },
    submitted: { label: "Soumis CENTIF", color: "text-primary", bg: "bg-primary/10" },
    rejected: { label: "Rejeté", color: "text-destructive", bg: "bg-destructive/10" },
  };

  const pendingApproval = strReports.filter((s: any) => s.status === "pending_approval");
  const drafts = strReports.filter((s: any) => s.status === "draft");
  const submitted = strReports.filter((s: any) => s.status === "submitted");
  const rejected = strReports.filter((s: any) => s.status === "rejected");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-accent" />
            Workflow d'Approbation STR
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Validation des déclarations de soupçon avant soumission CENTIF
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showTestForm} onOpenChange={setShowTestForm}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2 border-accent/30 text-accent hover:bg-accent/10">
                <Plus className="h-4 w-4" /> Créer STR de test
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-lg">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertOctagon className="h-4 w-4 text-accent" /> Nouveau STR — Brouillon de test</DialogTitle></DialogHeader>
              <form onSubmit={createTestSTR} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Sujet *</Label>
                    <Input value={testForm.subject_name} onChange={e => setTestForm(f => ({ ...f, subject_name: e.target.value }))} required className="bg-secondary/50 text-sm h-8 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Compte</Label>
                    <Input value={testForm.subject_account} onChange={e => setTestForm(f => ({ ...f, subject_account: e.target.value }))} className="bg-secondary/50 text-sm h-8 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Montant (XOF)</Label>
                    <Input type="number" value={testForm.transaction_amount} onChange={e => setTestForm(f => ({ ...f, transaction_amount: e.target.value }))} className="bg-secondary/50 text-sm h-8 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Canal</Label>
                    <Select value={testForm.transaction_channel} onValueChange={v => setTestForm(f => ({ ...f, transaction_channel: v }))}>
                      <SelectTrigger className="bg-secondary/50 h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Bank", "Mobile Money", "Crypto", "Cash", "Western Union"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Nature suspecte *</Label>
                  <Input value={testForm.suspicious_nature} onChange={e => setTestForm(f => ({ ...f, suspicious_nature: e.target.value }))} required className="bg-secondary/50 text-sm h-8 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Narration</Label>
                  <Textarea value={testForm.narrative} onChange={e => setTestForm(f => ({ ...f, narrative: e.target.value }))} rows={2} className="bg-secondary/30 border-border text-sm mt-1" />
                </div>
                <div className="flex items-center gap-2 p-2 bg-accent/10 rounded-lg border border-accent/20">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <p className="text-xs text-accent">Le STR sera créé en <strong>brouillon</strong>. Ensuite : "Envoyer en revue" → "Examiner" → "Approuver & Soumettre CENTIF"</p>
                </div>
                <Button type="submit" className="w-full gap-2" disabled={creatingTest}>
                  {creatingTest ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Créer le brouillon STR
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Actualiser
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <StatsCard title="En attente d'approbation" value={pendingApproval.length.toString()} warning={pendingApproval.length > 0} />
        <StatsCard title="Brouillons" value={drafts.length.toString()} />
        <StatsCard title="Soumis CENTIF" value={submitted.length.toString()} />
        <StatsCard title="Rejetés" value={rejected.length.toString()} danger={rejected.length > 0} />
      </div>

      {/* Pending approval queue */}
      {pendingApproval.length > 0 && (
        <Card className="bg-accent/5 border-accent/20">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-accent">
              <Clock className="h-4 w-4" />
              File d'attente — En attente d'approbation ({pendingApproval.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingApproval.map((str: any) => (
              <div key={str.id} className="flex items-center justify-between p-3 rounded-lg bg-card border border-border hover:border-accent/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{str.reference}</span>
                    <Badge variant="outline" className="text-xs">{str.transaction_channel}</Badge>
                    {Number(str.transaction_amount) >= 5_000_000 && (
                      <Badge variant="destructive" className="text-xs">≥ 5M XOF</Badge>
                    )}
                  </div>
                  <div className="text-sm font-medium text-foreground mt-0.5">{str.subject_name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{str.suspicious_nature}</div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="text-sm font-bold text-foreground">{Number(str.transaction_amount || 0).toLocaleString("fr-FR")} XOF</span>
                  <Button size="sm" variant="outline" onClick={() => setSelectedSTR(str)} className="h-7 text-xs">
                    Examiner
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Review dialog */}
      {selectedSTR && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelectedSTR(null)}>
          <Card className="w-full max-w-2xl bg-card border-border shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Examen STR — {selectedSTR.reference}</CardTitle>
                <button onClick={() => setSelectedSTR(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-5 w-5" /></button>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Sujet", value: selectedSTR.subject_name },
                  { label: "Compte", value: selectedSTR.subject_account || "N/A" },
                  { label: "Montant", value: `${Number(selectedSTR.transaction_amount || 0).toLocaleString("fr-FR")} XOF` },
                  { label: "Canal", value: selectedSTR.transaction_channel || "N/A" },
                  { label: "Date transaction", value: selectedSTR.transaction_date ? new Date(selectedSTR.transaction_date).toLocaleDateString("fr-FR") : "N/A" },
                  { label: "Créé le", value: new Date(selectedSTR.created_at).toLocaleDateString("fr-FR") },
                ].map(f => (
                  <div key={f.label} className="bg-secondary/30 rounded p-2">
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                    <div className="text-sm font-medium text-foreground">{f.value}</div>
                  </div>
                ))}
              </div>
              <div className="bg-secondary/20 rounded p-3">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Nature suspecte</div>
                <div className="text-sm text-foreground">{selectedSTR.suspicious_nature}</div>
              </div>
              {selectedSTR.narrative && (
                <div className="bg-secondary/20 rounded p-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Narration</div>
                  <div className="text-sm text-foreground whitespace-pre-wrap">{selectedSTR.narrative}</div>
                </div>
              )}
              {canApprove && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1">Note de validation / rejet</Label>
                    <Textarea
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                      placeholder="Ajoutez une note de validation ou un motif de rejet..."
                      rows={3}
                      className="bg-secondary/30 border-border text-sm mt-1"
                    />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <Button
                      className="flex-1 gap-2 bg-primary hover:bg-primary/90"
                      onClick={() => updateSTRStatus(selectedSTR.id, "submitted", reviewNote)}
                      disabled={updating}
                    >
                      <CheckSquare className="h-4 w-4" />
                      {updating ? "Soumission..." : "Approuver & Soumettre CENTIF"}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => updateSTRStatus(selectedSTR.id, "rejected", reviewNote)}
                      disabled={updating}
                    >
                      <XCircle className="h-4 w-4" />
                      Rejeter
                    </Button>
                  </div>
                </>
              )}
              {!canApprove && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Approbation réservée aux rôles : compliance_manager, org_admin, superadmin
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Full STR table */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Toutes les déclarations STR ({strReports.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Chargement...</div>
          ) : strReports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <AlertOctagon className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Aucune déclaration STR.</p>
              <p className="text-xs mt-1">Les STR sont créées automatiquement lorsqu'une transaction reçoit un score ≥ 70 avec l'action "declarer_STR".</p>
            </div>
          ) : (
            <div className="space-y-1">
              {strReports.map((str: any) => {
                const sc = statusConfig[str.status] || statusConfig.draft;
                return (
                  <div key={str.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/20 hover:bg-secondary/40 transition-colors text-sm">
                    <div className={`px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.color}`}>{sc.label}</div>
                    <span className="font-mono text-xs text-muted-foreground">{str.reference}</span>
                    <span className="font-medium text-foreground flex-1 truncate">{str.subject_name}</span>
                    <span className="text-xs text-muted-foreground">{Number(str.transaction_amount || 0).toLocaleString("fr-FR")} XOF</span>
                    <span className="text-xs text-muted-foreground">{new Date(str.created_at).toLocaleDateString("fr-FR")}</span>
                    {str.status === "draft" && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                        onClick={async () => {
                          const { error } = await supabase.from("str_reports").update({ status: "pending_approval" }).eq("id", str.id);
                          if (!error) {
                            toast({ title: "📋 STR envoyé en revue", description: "Les compliance managers ont été notifiés automatiquement." });
                            qc.invalidateQueries({ queryKey: ["notifications"] });
                          }
                          refetch();
                        }}>
                        Envoyer en revue
                      </Button>
                    )}
                    {str.status === "pending_approval" && (
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 border-accent/30 text-accent"
                        onClick={() => setSelectedSTR(str)}>
                        Examiner
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

