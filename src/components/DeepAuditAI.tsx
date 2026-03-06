import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, Legend,
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
} from "@/hooks/useSupabaseData";
import {
  useUserRole, useAllUserRoles, useAssignRole, useRevokeRole,
  useOrgInvitations, useCreateInvitation, useEtherscanLookup, useAuditLogs,
  type AppRole
} from "@/hooks/useRBAC";
import { supabase } from "@/integrations/supabase/client";
import LeafletMap from "@/components/LeafletMap";
import { LogOut, Plus, RefreshCw, AlertTriangle, Shield, BarChart2, Map, FileText, Settings as SettingsIcon, Home, List, Search, Bell, Users, Activity, Upload, Network, TrendingUp, Globe, Brain, Zap } from "lucide-react";

// ---- AI AML Transaction Scorer ----
function useAIAMLScore() {
  const [scores, setScores] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const analyzeTransaction = useCallback(async (tx: any, allTx: any[]) => {
    setLoading(tx.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/aml-score-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ transaction: tx, allTransactions: allTx.slice(0, 30) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur IA");
      setScores(prev => ({ ...prev, [tx.id]: data }));
      return data;
    } catch (e: any) {
      throw e;
    } finally {
      setLoading(null);
    }
  }, []);

  return { scores, loading, analyzeTransaction };
}

const MODULES = [
  { key: "dashboard", label: "Tableau de bord", icon: Home },
  { key: "transactions", label: "Transactions", icon: List },
  { key: "mobile_money", label: "Mobile Money Import", icon: Upload },
  { key: "smurfing", label: "Détection Smurfing", icon: Network },
  { key: "blockchain", label: "Explorateur Blockchain", icon: Search },
  { key: "analytics", label: "Analytics", icon: BarChart2 },
  { key: "audit", label: "Audit", icon: Shield },
  { key: "compliance", label: "Conformité BCEAO", icon: Shield },
  { key: "geolocation", label: "Géolocalisation", icon: Map },
  { key: "reports", label: "Rapports", icon: FileText },
  { key: "users", label: "Utilisateurs", icon: Users },
  { key: "settings", label: "Paramètres", icon: SettingsIcon },
];

export default function DeepAuditAIPlatform() {
  const [activeModule, setActiveModule] = useState("dashboard");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [realtimeAlerts, setRealtimeAlerts] = useState<any[]>([]);
  const [liveCounts, setLiveCounts] = useState({ openAlerts: 0, suspiciousTx: 0, newAlertFlash: false, newTxFlash: false });
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { data: profile } = useProfile();
  const { data: userRole } = useUserRole();
  const { data: alerts = [] } = useAlerts();
  const { data: transactions = [] } = useTransactions();

  const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  const filteredModules = searchQuery
    ? MODULES.filter(m => m.label.toLowerCase().includes(searchQuery.toLowerCase()))
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
        setRealtimeAlerts((prev) => [alert, ...prev].slice(0, 5));
        setLiveCounts(prev => ({ ...prev, openAlerts: prev.openAlerts + 1, newAlertFlash: true }));
        setTimeout(() => setLiveCounts(prev => ({ ...prev, newAlertFlash: false })), 2000);
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
  }, [toast]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Topbar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border backdrop-blur-sm bg-card/50 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src={logo} alt="DeepAuditAI" className="h-10 w-auto rounded-md shadow-lg" />
          <div>
            <div className="text-lg font-bold text-foreground leading-tight">DeepAuditAI</div>
            <div className="text-xs text-muted-foreground">L'Œil de la Traçabilité</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live counters */}
          <div className="hidden md:flex items-center gap-2">
            <motion.div
              animate={liveCounts.newAlertFlash ? { scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 0.4 }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                liveCounts.openAlerts > 0
                  ? "bg-destructive/15 border-destructive/30 text-destructive"
                  : "bg-secondary/50 border-border text-muted-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${liveCounts.openAlerts > 0 ? "bg-destructive animate-pulse" : "bg-muted-foreground"}`} />
              {liveCounts.openAlerts} alerte{liveCounts.openAlerts !== 1 ? "s" : ""}
            </motion.div>
            <motion.div
              animate={liveCounts.newTxFlash ? { scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 0.4 }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                liveCounts.suspiciousTx > 0
                  ? "bg-accent/15 border-accent/30 text-accent"
                  : "bg-secondary/50 border-border text-muted-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${liveCounts.suspiciousTx > 0 ? "bg-accent animate-pulse" : "bg-muted-foreground"}`} />
              {liveCounts.suspiciousTx} tx suspecte{liveCounts.suspiciousTx !== 1 ? "s" : ""}
            </motion.div>
          </div>

          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrer les modules..."
            className="w-48 bg-secondary/50 border-border text-sm"
            aria-label="Filtrer modules"
          />
          {realtimeAlerts.length > 0 && (
            <div className="relative">
              <Bell className="h-5 w-5 text-accent animate-pulse" />
              <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {realtimeAlerts.length}
              </span>
            </div>
          )}
          <div className="text-sm text-muted-foreground hidden md:block flex flex-col items-end">
            <span>{profile?.full_name || user?.email}</span>
            {userRole && (
              <Badge variant="secondary" className="text-xs mt-0.5">{userRole}</Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-1" /> Déconnexion
          </Button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 p-3 border-r border-border bg-card/30 backdrop-blur-sm min-h-[calc(100vh-57px)] flex flex-col">
          <nav className="flex flex-col gap-1">
            {filteredModules.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveModule(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm font-medium transition-all ${
                  activeModule === key
                    ? "bg-gradient-to-r from-accent/20 to-primary/10 border-l-4 border-accent shadow-sm text-foreground"
                    : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-4">
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
            {activeModule === "transactions" && <Transactions />}
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
            {activeModule === "compliance" && <ComplianceBCEAO />}
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
  return (
    <div>
      <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> Alertes
      </h4>
      <div className="flex flex-col gap-1">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Chargement...</div>
        ) : alerts.length === 0 ? (
          <div className="text-xs text-muted-foreground">Aucune alerte</div>
        ) : (
          alerts.slice(0, 4).map((a: any) => (
            <div key={a.id} className="text-xs p-2 rounded bg-accent/10 border border-accent/20">
              <div className="font-medium text-foreground truncate">{a.title}</div>
              <div className="text-muted-foreground mt-0.5">
                {new Date(a.created_at).toLocaleDateString("fr-FR")}
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
          <h2 className="text-2xl font-bold">Dashboard Superadmin</h2>
          <p className="text-sm text-muted-foreground">Vue globale toutes organisations · Temps réel</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-destructive/20 text-destructive border-destructive/30">⚡ Superadmin</Badge>
          <Badge variant="secondary" className="text-xs">{new Date().toLocaleDateString("fr-FR")}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        <StatsCard title="Volume total" value={formatCurrency(monthVolume)} />
        <StatsCard title="Transactions" value={transactions.length.toString()} />
        <StatsCard title="Alertes critiques" value={highAlerts.toString()} danger />
        <StatsCard title="Score AML moyen" value={`${avgAmlScore}/100`} warning={avgAmlScore > 30} danger={avgAmlScore > 60} />
        <StatsCard title="Utilisateurs" value={userRoles.length.toString()} />
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
            <CardHeader><CardTitle className="text-sm">Actions rapides</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Gérer les utilisateurs", module: "users" },
                { label: "Voir les alertes", module: "audit" },
                { label: "Smurfing avancé", module: "smurfing" },
                { label: "Rapports AML", module: "reports" },
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
          <CardHeader><CardTitle className="text-base">Transactions à haut risque AML</CardTitle></CardHeader>
          <CardContent>
            {transactions.filter((t: any) => computeAMLScore(t, transactions).score >= 70).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Aucune transaction à haut risque</p>
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
          <CardHeader><CardTitle className="text-base">Adresses à risque</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune adresse</p>
            ) : (
              addresses.slice(0, 4).map((g: any) => (
                <div key={g.id} className="p-2 rounded-md bg-secondary/50 flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs truncate w-28">{g.address}</div>
                    <div className="text-xs text-muted-foreground">Score: <span className="text-accent font-semibold">{g.risk_score}</span></div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onExplore(g.address)}>Explorer</Button>
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
          <h2 className="text-2xl font-bold">Dashboard Organisation</h2>
          <p className="text-sm text-muted-foreground">Vue de votre organisation · Conformité AML</p>
        </div>
        <Badge className="bg-primary/20 text-primary border-primary/30">🏢 Org Admin</Badge>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard title="Score conformité" value={`${complianceScore}/100`} warning={complianceScore < 70} danger={complianceScore < 40} />
        <StatsCard title="Alertes ouvertes" value={openAlerts.length.toString()} danger={openAlerts.length > 0} />
        <StatsCard title="Membres équipe" value={userRoles.length.toString()} />
        <StatsCard title="Cas signalés" value={transactions.filter((t: any) => t.flagged).length.toString()} warning />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">Score de conformité</CardTitle></CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <div className={`text-6xl font-black mb-2 ${complianceScore >= 70 ? "text-primary" : complianceScore >= 40 ? "text-accent" : "text-destructive"}`}>
                {complianceScore}
              </div>
              <div className="text-sm text-muted-foreground">Score de conformité AML / 100</div>
              <div className="mt-4 h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${complianceScore >= 70 ? "bg-primary" : complianceScore >= 40 ? "bg-accent" : "bg-destructive"}`}
                  style={{ width: `${complianceScore}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {complianceScore >= 70 ? "✅ Conforme" : complianceScore >= 40 ? "⚠️ Attention requise" : "🚨 Non conforme — Action immédiate"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">Activité de l'équipe</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {userRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun membre enregistré</p>
            ) : (
              userRoles.slice(0, 5).map((ur: any) => (
                <div key={ur.id} className="flex items-center justify-between">
                  <div className="font-mono text-xs">{ur.user_id.slice(0, 16)}...</div>
                  <Badge variant="secondary" className="text-xs">{ur.role}</Badge>
                </div>
              ))
            )}
            <Button variant="outline" size="sm" className="w-full text-xs mt-2" onClick={() => onNavigate("users")}>
              Gérer les membres →
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "📊 Analytics", desc: "Rapports et tendances", module: "analytics" },
          { label: "🔍 Smurfing", desc: "Détection patterns 30j", module: "smurfing" },
          { label: "📄 Rapports AML", desc: "Génération et export", module: "reports" },
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
          <h2 className="text-2xl font-bold">Dashboard Analyste</h2>
          <p className="text-sm text-muted-foreground">Mes investigations assignées · AML</p>
        </div>
        <Badge className="bg-secondary text-foreground border-border">🔬 Analyste AML</Badge>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard title="Mes transactions" value={transactions.length.toString()} />
        <StatsCard title="Cas haute priorité" value={highRisk.length.toString()} danger={highRisk.length > 0} />
        <StatsCard title="Alertes ouvertes" value={myAlerts.length.toString()} warning={myAlerts.length > 0} />
        <StatsCard title="Cas signalés" value={transactions.filter((t: any) => t.flagged).length.toString()} warning />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Transactions haute priorité</CardTitle></CardHeader>
          <CardContent>
            {highRisk.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">✅ Aucun cas haute priorité</div>
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
            <CardHeader><CardTitle className="text-base">Transactions récentes</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune transaction</p>
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
              { label: "Ajouter transaction", module: "transactions" },
              { label: "Importer CSV", module: "mobile_money" },
              { label: "Détection smurfing", module: "smurfing" },
              { label: "Générer rapport", module: "reports" },
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
        <h2 className="text-2xl font-bold">Tableau de bord</h2>
        <span className="text-sm text-muted-foreground">Real-time · IA · Blockchain</span>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard title="Volume total" value={formatCurrency(monthVolume)} />
        <StatsCard title="Transactions" value={transactions.length.toString()} />
        <StatsCard title="Alertes actives" value={alerts.filter((a: any) => a.status === "open").length.toString()} danger />
        <StatsCard title="Cas signalés" value={flaggedCount.toString()} warning />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Tendance des volumes</CardTitle></CardHeader>
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
            <CardHeader><CardTitle className="text-base">Répartition par canal</CardTitle></CardHeader>
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
            <p className="text-lg font-medium text-muted-foreground mb-2">Détection automatique de smurfing</p>
            <p className="text-sm text-muted-foreground mb-6">
              Analyse les patterns sur 30 jours : montants répétés, comptes multiples, intervalles réguliers, structuration sous seuil.
            </p>
            <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mb-6">
              {[
                { icon: "🔁", label: "Montants répétés", desc: "Mêmes montants ≥3x" },
                { icon: "⏱️", label: "Intervalles réguliers", desc: "±2 jours de régularité" },
                { icon: "📉", label: "Structuration", desc: "Montants 2.5-3M XOF" },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="p-3 bg-secondary/30 rounded-lg text-sm">
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              ))}
            </div>
            <Button onClick={analyze} disabled={isAnalyzing}>
              <Network className="h-4 w-4 mr-2" /> Analyser {transactions.length} transactions
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <StatsCard title="Transactions analysées" value={report.analyzedCount.toString()} />
            <StatsCard title="Patterns suspects" value={report.suspects.length.toString()} danger={report.suspects.length > 0} />
            <StatsCard title="Période" value={report.period} />
          </div>

          {report.suspects.length === 0 ? (
            <Card className="bg-card/50 border-border">
              <CardContent className="p-8 text-center">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-lg font-medium">Aucun pattern suspect détecté</p>
                <p className="text-sm text-muted-foreground">Vos transactions ne montrent pas de schémas de structuration sur 30 jours.</p>
              </CardContent>
            </Card>
          ) : (
            report.suspects.map((s: any, i: number) => (
              <Card key={s.account} className="bg-card/50 border-destructive/30 border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      Suspect #{i + 1} — Compte <span className="font-mono">{s.account}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">{s.txCount} transactions</Badge>
                      <Badge variant="secondary">{formatCurrency(s.totalAmount)}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Risques détectés</div>
                    <div className="flex flex-wrap gap-2">
                      {s.risk.map((r: string) => (
                        <Badge key={r} variant="outline" className="text-xs border-destructive/30 text-destructive">{r}</Badge>
                      ))}
                    </div>
                  </div>

                  {/* Network graph - simplified visual */}
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Graphe de réseau</div>
                    <div className="bg-secondary/20 rounded-lg p-4 overflow-x-auto">
                      <div className="flex items-center gap-3 min-w-max">
                        <div className="bg-destructive/20 border border-destructive/30 rounded-lg p-3 text-center min-w-24">
                          <div className="text-xs font-bold text-destructive">COMPTE</div>
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
                            <div className="text-xs text-muted-foreground pl-10">+{s.networkLinks.length - 6} autres...</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="border-b border-border">
                        <tr className="text-muted-foreground">
                          <th className="py-1 pr-3 text-left">Date</th>
                          <th className="py-1 pr-3 text-left">Réf</th>
                          <th className="py-1 pr-3 text-left">Montant</th>
                          <th className="py-1 pr-3 text-left">Canal</th>
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
function Transactions() {
  const { data: transactions = [], isLoading, refetch } = useTransactions();
  const createTx = useCreateTransaction();
  const createAlert = useCreateAlert();
  const updateTx = useUpdateTransaction();
  const { toast } = useToast();
  const { scores: aiScores, loading: aiLoading, analyzeTransaction } = useAIAMLScore();
  const [page, setPage] = useState(0);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
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

  const ACTION_LABELS: Record<string, { label: string; color: string }> = {
    surveiller: { label: "Surveiller", color: "text-muted-foreground" },
    signaler: { label: "🚩 Signaler", color: "text-accent" },
    declarer_STR: { label: "🔴 Déclarer STR", color: "text-destructive" },
    bloquer: { label: "🚫 Bloquer", color: "text-destructive" },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Transactions</h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Brain className="h-3 w-3 text-primary" />
            Cliquer sur <strong>Analyser IA</strong> pour obtenir un scoring Gemini et une recommandation d'action
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Actualiser
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadCSV}>
            Exporter CSV
          </Button>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Ajouter</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>Nouvelle transaction</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>Référence *</Label>
                    <Input required value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} placeholder="TX-000001" className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>Compte *</Label>
                    <Input required value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="ACC-0001" className="bg-secondary/50" />
                  </div>
                  <div>
                    <Label>Montant *</Label>
                    <Input required type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" className="bg-secondary/50" />
                  </div>
                </div>
                <div>
                  <Label>Canal</Label>
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
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-secondary/50" rows={2} />
                </div>
                <Button type="submit" className="w-full" disabled={createTx.isPending}>
                  {createTx.isPending ? "Ajout..." : "Ajouter la transaction"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="bg-card/50 border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Chargement...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Réf</th>
                    <th className="px-4 py-3 text-left">Compte</th>
                    <th className="px-4 py-3 text-left">Montant</th>
                    <th className="px-4 py-3 text-left">Canal</th>
                    <th className="px-4 py-3 text-left">Score AML</th>
                    <th className="px-4 py-3 text-left">Analyse IA</th>
                    <th className="px-4 py-3 text-left">Statut</th>
                    <th className="px-4 py-3 text-left">Actions</th>
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
                            <div className="flex items-center gap-1" title={reasons.join(" | ")}>
                              <div className={`text-xs font-bold ${score >= 70 ? "text-destructive" : score >= 40 ? "text-accent" : "text-muted-foreground"}`}>
                                {score}/100
                              </div>
                              {score >= 40 && <span className="text-xs">{score >= 70 ? "🔴" : "🟡"}</span>}
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
                                  : <><Brain className="h-3 w-3 mr-1" />Analyser IA</>
                                }
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {t.flagged ? (
                              <Badge variant="destructive" className="text-xs">Signalé</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Normal</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedTx(t)}>
                                Détails
                              </Button>
                              <Button size="sm" variant={t.flagged ? "outline" : "destructive"} className="h-7 text-xs" onClick={() => handleFlag(t)}>
                                {t.flagged ? "Retirer" : "Signaler"}
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
                                  <span className="text-sm font-bold text-primary">Analyse IA Gemini — {t.ref}</span>
                                  <Badge variant={aiResult.riskScore >= 70 ? "destructive" : aiResult.riskScore >= 40 ? "secondary" : "outline"} className="text-xs">
                                    Risque: {aiResult.riskLevel}
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
                                  Action recommandée: {ACTION_LABELS[aiResult.recommendedAction]?.label || aiResult.recommendedAction}
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {pageItems.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Aucune transaction. Ajoutez-en une.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {transactions.length > pageSize && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Préc</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} / {Math.ceil(transactions.length / pageSize)}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(Math.ceil(transactions.length / pageSize) - 1, page + 1))} disabled={page >= Math.ceil(transactions.length / pageSize) - 1}>Suiv</Button>
        </div>
      )}

      {selectedTx && (
        <Dialog open={!!selectedTx} onOpenChange={() => setSelectedTx(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Détails — {selectedTx.ref}</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Date", selectedTx.date],
                  ["Référence", selectedTx.ref],
                  ["Compte", selectedTx.account],
                  ["Montant", formatCurrency(selectedTx.amount)],
                  ["Canal", selectedTx.channel],
                  ["Statut", selectedTx.flagged ? "Signalé" : "Normal"],
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
      toast({ title: "Adresse ajoutée" });
      setShowAdd(false);
      setForm({ address: "", network: "ethereum", risk_score: "0", label: "", notes: "" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Explorateur Blockchain / Web3</h2>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Suivre une adresse</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Nouvelle adresse surveillée</DialogTitle></DialogHeader>
            <form onSubmit={handleAddAddress} className="space-y-3">
              <div>
                <Label>Adresse *</Label>
                <Input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="0x..." className="bg-secondary/50 font-mono text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Réseau</Label>
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
                  <Label>Score risque (0-100)</Label>
                  <Input type="number" min="0" max="100" value={form.risk_score} onChange={e => setForm(f => ({ ...f, risk_score: e.target.value }))} className="bg-secondary/50" />
                </div>
              </div>
              <div>
                <Label>Label</Label>
                <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Exchange, Whale..." className="bg-secondary/50" />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-secondary/50" rows={2} />
              </div>
              <Button type="submit" className="w-full" disabled={addAddress.isPending}>
                {addAddress.isPending ? "Ajout..." : "Ajouter l'adresse"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Recherche on-chain (Etherscan)</CardTitle></CardHeader>
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
                  {ethLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Analyser"}
                </Button>
              </div>

              {ethError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">{ethError}</div>
              )}

              {ethData && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-secondary/30 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">Solde</div>
                      <div className="font-bold text-lg text-primary">{ethData.balance} ETH</div>
                    </div>
                    <div className="p-3 bg-secondary/30 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">Transactions</div>
                      <div className="font-bold text-lg">{ethData.transactionCount}</div>
                    </div>
                    <div className="p-3 bg-secondary/30 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">Réseau</div>
                      <div className="font-bold capitalize">{ethData.network}</div>
                    </div>
                  </div>

                  {ethData.transactions.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Dernières transactions on-chain</div>
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {ethData.transactions.map((tx: any) => (
                          <div key={tx.hash} className={`p-2 rounded text-xs font-mono flex items-center justify-between ${tx.isError ? "bg-destructive/10 border border-destructive/20" : "bg-secondary/30"}`}>
                            <div className="flex-1 min-w-0">
                              <span className="text-muted-foreground truncate block">{tx.hash.slice(0, 20)}...</span>
                              <span className="text-muted-foreground">{new Date(tx.timestamp).toLocaleDateString("fr-FR")}</span>
                            </div>
                            <div className="text-right ml-3">
                              <div className={`font-semibold ${tx.isError ? "text-destructive" : "text-primary"}`}>{tx.value} ETH</div>
                              {tx.isError && <Badge variant="destructive" className="text-xs">Erreur</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openExternal(`https://etherscan.io/address/${ethData.address}`)}>
                      Voir sur Etherscan
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openExternal(`https://debank.com/profile/${ethData.address}`)}>
                      DeBank
                    </Button>
                  </div>
                </div>
              )}

              {!ethData && !ethLoading && !ethError && (
                <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                  Entrez une adresse pour récupérer les données on-chain via Etherscan
                </div>
              )}
            </CardContent>
          </Card>

          {selectedAddress && current && (
            <Card className="bg-card/50 border-border">
              <CardHeader><CardTitle className="text-base">Profil surveillance interne</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-secondary/30 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground">Réseau</div>
                    <div className="font-semibold capitalize">{current.network}</div>
                  </div>
                  <div className="p-3 bg-secondary/30 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground">Score risque</div>
                    <div className={`font-bold text-lg ${(current.risk_score || 0) > 70 ? "text-destructive" : (current.risk_score || 0) > 40 ? "text-accent" : "text-primary"}`}>
                      {current.risk_score}
                    </div>
                  </div>
                  <div className="p-3 bg-secondary/30 rounded-lg text-center">
                    <div className="text-xs text-muted-foreground">Label</div>
                    <div className="font-semibold">{current.label || "—"}</div>
                  </div>
                </div>
                {current.notes && <p className="text-sm text-muted-foreground mt-3 p-2 bg-secondary/20 rounded">{current.notes}</p>}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">Adresses suivies ({addresses.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Chargement...</div>
            ) : addresses.length === 0 ? (
              <div className="text-sm text-muted-foreground">Aucune adresse. Ajoutez-en une.</div>
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

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Analytics & Prévisions</h2>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatsCard title="Volume total" value={formatCurrency(totalVolume)} />
        <StatsCard title="Volume signalé" value={formatCurrency(flaggedVolume)} warning />
        <StatsCard title="Taux signalement" value={`${totalVolume > 0 ? ((flaggedVolume / totalVolume) * 100).toFixed(1) : "0"}%`} danger />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">Évolution mensuelle</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-base">Répartition par canal</CardTitle></CardHeader>
          <CardContent>
            <div className="h-52">
              {channelData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Aucune donnée</div>
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
          <CardHeader><CardTitle className="text-base">Indicateurs de risque</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Transactions suspectes", value: transactions.filter((t: any) => t.flagged).length, total: transactions.length },
              { label: "Alertes ouvertes", value: alerts.filter((a: any) => a.status === "open").length, total: alerts.length },
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
          <CardHeader><CardTitle className="text-base">Scores d'alertes par sévérité</CardTitle></CardHeader>
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
            {alerts.length === 0 && <p className="text-sm text-muted-foreground">Aucune alerte enregistrée</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Audit ----
function Audit() {
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
        <h2 className="text-2xl font-bold">Audit des décaissements</h2>
        <Dialog open={showAddAlert} onOpenChange={setShowAddAlert}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nouvelle alerte</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Créer une alerte</DialogTitle></DialogHeader>
            <form onSubmit={handleAddAlert} className="space-y-3">
              <div>
                <Label>Titre *</Label>
                <Input required value={alertForm.title} onChange={e => setAlertForm(f => ({ ...f, title: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={alertForm.description} onChange={e => setAlertForm(f => ({ ...f, description: e.target.value }))} className="bg-secondary/50" rows={3} />
              </div>
              <div>
                <Label>Sévérité</Label>
                <Select value={alertForm.severity} onValueChange={v => setAlertForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Faible</SelectItem>
                    <SelectItem value="medium">Moyenne</SelectItem>
                    <SelectItem value="high">Haute</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createAlert.isPending}>
                {createAlert.isPending ? "Création..." : "Créer l'alerte"}
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
              Transactions signalées ({flagged.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Chargement...</div>
            ) : flagged.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Aucun cas critique détecté</div>
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
            <CardHeader><CardTitle className="text-base">Workflow d'investigation</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {[
                  "Collecte des preuves documentaires",
                  "Corrélation des flux financiers",
                  "Analyse des adresses blockchain",
                  "Géolocalisation (si autorisée)",
                  "Rédaction du rapport AML",
                  "Escalade aux autorités compétentes",
                ].map((step, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Alertes ({alerts.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-48 overflow-y-auto">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune alerte. Créez-en une.</p>
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
  const channelCounts: Record<string, number> = {};
  transactions.forEach((t: any) => (channelCounts[t.channel] = (channelCounts[t.channel] || 0) + 1));

  const COUNTRY_FLOW = [
    { country: "Sénégal", pct: "42%", volume: "4 200 000 XOF", color: "#22c55e" },
    { country: "Côte d'Ivoire", pct: "28%", volume: "2 800 000 XOF", color: "#f59e0b" },
    { country: "Mali", pct: "18%", volume: "1 800 000 XOF", color: "#3b82f6" },
    { country: "Burkina Faso", pct: "8%", volume: "800 000 XOF", color: "#8b5cf6" },
    { country: "Guinée", pct: "4%", volume: "400 000 XOF", color: "#ec4899" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Géolocalisation des flux</h2>
        <Badge variant="secondary" className="text-xs">Afrique de l'Ouest · Données simulées</Badge>
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

// ---- Settings ----
function SettingsModule() {
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ full_name: "", organization: "" });

  React.useEffect(() => {
    if (profile) setForm({ full_name: profile.full_name || "", organization: profile.organization || "" });
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync(form);
      toast({ title: "Profil mis à jour" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Paramètres</h2>
      <div className="grid grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader><CardTitle className="text-base">Profil utilisateur</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <Label>Email</Label>
                <Input value={user?.email || ""} disabled className="bg-secondary/30 text-muted-foreground" />
              </div>
              <div>
                <Label>Nom complet</Label>
                <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div>
                <Label>Organisation</Label>
                <Input value={form.organization} onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} placeholder="Nom de votre organisation" className="bg-secondary/50" />
              </div>
              <div>
                <Label>Rôle</Label>
                <Input value={profile?.role || "auditor"} disabled className="bg-secondary/30 text-muted-foreground" />
              </div>
              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Sauvegarde..." : "Sauvegarder"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Connecteurs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { name: "Etherscan API", status: "Configuré ✓", desc: "Données blockchain Ethereum" },
                { name: "BscScan API", status: "Non configuré", desc: "Données blockchain BNB Chain" },
                { name: "TheGraph", status: "Non configuré", desc: "Indexeur DeFi" },
              ].map(({ name, status, desc }) => (
                <div key={name} className="flex items-center justify-between p-3 bg-secondary/30 rounded">
                  <div>
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                  <Badge variant="outline" className="text-xs">{status}</Badge>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Les clés API sont configurées côté serveur (jamais en frontend).</p>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Rôles & Permissions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { role: "superadmin", desc: "Accès total" },
                  { role: "org_admin", desc: "Gestion de l'organisation" },
                  { role: "auditor", desc: "Lecture/écriture des audits" },
                  { role: "read_only", desc: "Lecture seule" },
                ].map(({ role, desc }) => (
                  <div key={role} className={`flex items-center justify-between p-2 rounded text-sm ${profile?.role === role ? "bg-accent/20 border border-accent/30" : "bg-secondary/30"}`}>
                    <span className="font-medium">{role}</span>
                    <span className="text-xs text-muted-foreground">{desc}</span>
                    {profile?.role === role && <Badge className="text-xs ml-2">Actuel</Badge>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatsCard title="Score conformité" value={`${complianceScore}/100`} warning={complianceScore < 75} danger={complianceScore < 50} />
        <StatsCard title="Items validés" value={`${completedCount}/${totalItems}`} />
        <StatsCard title="Alertes haute sévérité" value={highAlerts.length.toString()} danger={highAlerts.length > 0} />
        <StatsCard title="STR soumises" value={strReports.length.toString()} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Checklist */}
        <div className="col-span-2 space-y-4">
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Checklist LBC/FT — Obligations BCEAO</CardTitle>
                <div className="w-32 h-2 bg-secondary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${complianceScore >= 75 ? "bg-primary" : complianceScore >= 50 ? "bg-accent" : "bg-destructive"}`} style={{ width: `${complianceScore}%` }} />
                </div>
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
  const { data: userRoles = [], isLoading } = useAllUserRoles();
  const { data: invitations = [] } = useOrgInvitations();
  const { data: myRole } = useUserRole();
  const assignRole = useAssignRole();
  const revokeRole = useRevokeRole();
  const createInvitation = useCreateInvitation();
  const { toast } = useToast();
  const [inviteForm, setInviteForm] = useState({ email: "", role: "auditor" as AppRole });
  const [showInvite, setShowInvite] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: "", role: "auditor" as AppRole });
  const [showAssign, setShowAssign] = useState(false);

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

  const ROLE_DESCS: Record<string, string> = {
    superadmin: "Accès total, gestion infra",
    org_admin: "Gestion organisation et utilisateurs",
    compliance_manager: "Config règles, tableaux de bord, rapports",
    analyst: "Analyse transactions, investigations",
    forensic_analyst: "Analyses forensiques, exports signés",
    auditor: "Lecture/écriture audits, rapports",
    read_only: "Consultation uniquement",
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createInvitation.mutateAsync(inviteForm);
      toast({ title: "Invitation créée", description: `${inviteForm.email} sera notifié(e) lors de son inscription` });
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
      toast({ title: `Rôle ${assignForm.role} assigné avec succès` });
      setShowAssign(false);
      setAssignForm({ userId: "", role: "auditor" });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Gestion des utilisateurs</h2>
          <p className="text-sm text-muted-foreground mt-1">RBAC — Contrôle d'accès basé sur les rôles</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {isSuperadmin && (
              <Dialog open={showAssign} onOpenChange={setShowAssign}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary"><Shield className="h-4 w-4 mr-1" /> Assigner un rôle</Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-border">
                  <DialogHeader><DialogTitle>Assigner un rôle à un utilisateur existant</DialogTitle></DialogHeader>
                  <form onSubmit={handleAssignRole} className="space-y-4">
                    <div>
                      <Label>User ID (UUID) *</Label>
                      <Input
                        required
                        value={assignForm.userId}
                        onChange={e => setAssignForm(f => ({ ...f, userId: e.target.value }))}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        className="bg-secondary/50 font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Copier l'UUID depuis la liste des utilisateurs ci-dessous</p>
                    </div>
                    <div>
                      <Label>Rôle à assigner</Label>
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
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Inviter un utilisateur</Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>Inviter un utilisateur</DialogTitle></DialogHeader>
                <form onSubmit={handleInvite} className="space-y-4">
                  <div>
                    <Label>Email *</Label>
                    <Input
                      required
                      type="email"
                      value={inviteForm.email}
                      onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="email@organisation.com"
                      className="bg-secondary/50"
                    />
                  </div>
                  <div>
                    <Label>Rôle assigné</Label>
                    <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v as AppRole }))}>
                      <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_DESCS).map(([role, desc]) => (
                          <SelectItem key={role} value={role}>
                            {role} — {desc}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{ROLE_DESCS[inviteForm.role]}</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={createInvitation.isPending}>
                    {createInvitation.isPending ? "Envoi..." : "Créer l'invitation"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Current users with roles */}
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Utilisateurs actifs ({userRoles.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Chargement...</div>
            ) : userRoles.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Aucun utilisateur enregistré</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {userRoles.map((ur: any) => (
                  <div key={ur.id} className="p-3 bg-secondary/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono select-all cursor-text" title="Cliquez pour copier l'UUID">{ur.user_id}</div>
                        <div className={`text-sm font-semibold ${ROLE_COLORS[ur.role] || "text-foreground"}`}>{ur.role}</div>
                        <div className="text-xs text-muted-foreground">{ROLE_DESCS[ur.role]}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="text-xs text-muted-foreground">
                          {new Date(ur.assigned_at).toLocaleDateString("fr-FR")}
                        </div>
                        {isAdmin && ur.role !== "superadmin" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                            onClick={async () => {
                              try {
                                await revokeRole.mutateAsync({ userId: ur.user_id, role: ur.role });
                                toast({ title: "Rôle révoqué" });
                              } catch (e: any) {
                                toast({ title: "Erreur", description: e.message, variant: "destructive" });
                              }
                            }}
                          >
                            Révoquer
                          </Button>
                        )}
                        {isSuperadmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => { setAssignForm(f => ({ ...f, userId: ur.user_id })); setShowAssign(true); }}
                          >
                            Changer rôle
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Invitations */}
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Invitations en attente ({invitations.filter((i: any) => i.status === "pending").length})</CardTitle></CardHeader>
            <CardContent>
              {invitations.filter((i: any) => i.status === "pending").length === 0 ? (
                <div className="text-sm text-muted-foreground py-2 text-center">Aucune invitation en attente</div>
              ) : (
                <div className="space-y-2">
                  {invitations.filter((i: any) => i.status === "pending").map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between p-2 bg-secondary/30 rounded text-sm">
                      <div>
                        <div className="font-medium">{inv.email}</div>
                        <div className={`text-xs ${ROLE_COLORS[inv.role] || ""}`}>{inv.role}</div>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline" className="text-xs">En attente</Badge>
                        <div className="text-xs text-muted-foreground mt-1">
                          Expire: {new Date(inv.expires_at).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Roles matrix */}
          <Card className="bg-card/50 border-border">
            <CardHeader><CardTitle className="text-base">Matrice des rôles & Permissions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(ROLE_DESCS).map(([role, desc]) => (
                  <div key={role} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                    <span className={`text-sm font-medium ${ROLE_COLORS[role] || ""}`}>{role}</span>
                    <span className="text-xs text-muted-foreground text-right max-w-44">{desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
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
