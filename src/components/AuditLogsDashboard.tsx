import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuditLogs } from "@/hooks/useRBAC";
import { Activity, Shield, Search, Clock, Users, FileText, Download, Filter } from "lucide-react";
import { format, subDays, parseISO, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";

const ACTION_COLORS: Record<string, string> = {
  export_csv: "hsl(var(--primary))",
  login: "hsl(var(--accent))",
  create: "hsl(142, 76%, 36%)",
  update: "hsl(45, 93%, 47%)",
  delete: "hsl(var(--destructive))",
  view: "hsl(220, 70%, 50%)",
  score_aml: "hsl(280, 60%, 50%)",
  generate_report: "hsl(200, 70%, 50%)",
};

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(142, 76%, 36%)",
  "hsl(45, 93%, 47%)",
  "hsl(var(--destructive))",
  "hsl(220, 70%, 50%)",
  "hsl(280, 60%, 50%)",
  "hsl(200, 70%, 50%)",
];

function getActionLabel(action: string) {
  const map: Record<string, string> = {
    export_csv: "Export CSV",
    login: "Connexion",
    create: "Création",
    update: "Mise à jour",
    delete: "Suppression",
    view: "Consultation",
    score_aml: "Scoring AML",
    generate_report: "Génération rapport",
  };
  return map[action] || action;
}

function getResourceLabel(type: string) {
  const map: Record<string, string> = {
    notifications: "Notifications",
    transactions: "Transactions",
    str_reports: "Rapports STR",
    alerts: "Alertes",
    reports: "Rapports",
    users: "Utilisateurs",
    aml_rules: "Règles AML",
    dossiers: "Dossiers",
  };
  return map[type] || type;
}

export default function AuditLogsDashboard() {
  const { data: logs = [], isLoading } = useAuditLogs();
  const [actionFilter, setActionFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [daysRange, setDaysRange] = useState(30);

  const filteredLogs = useMemo(() => {
    const cutoff = subDays(new Date(), daysRange);
    return (logs as any[]).filter(l => {
      if (new Date(l.created_at) < cutoff) return false;
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          l.action?.toLowerCase().includes(q) ||
          l.resource_type?.toLowerCase().includes(q) ||
          l.user_id?.toLowerCase().includes(q) ||
          JSON.stringify(l.details || {}).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, actionFilter, searchQuery, daysRange]);

  // Stats
  const uniqueActions = useMemo(() => [...new Set((logs as any[]).map(l => l.action))], [logs]);
  const uniqueUsers = useMemo(() => [...new Set((logs as any[]).map(l => l.user_id))], [logs]);

  // Activity by day (line chart)
  const activityByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = daysRange - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      map[d] = 0;
    }
    filteredLogs.forEach(l => {
      const d = format(parseISO(l.created_at), "yyyy-MM-dd");
      if (map[d] !== undefined) map[d]++;
    });
    return Object.entries(map).map(([date, count]) => ({
      date: format(parseISO(date), "dd MMM", { locale: fr }),
      count,
    }));
  }, [filteredLogs, daysRange]);

  // By action type (pie)
  const byAction = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLogs.forEach(l => {
      map[l.action] = (map[l.action] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name: getActionLabel(name), value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredLogs]);

  // By resource type (bar)
  const byResource = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLogs.forEach(l => {
      map[l.resource_type] = (map[l.resource_type] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name: getResourceLabel(name), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredLogs]);

  // By user (top 5 bar)
  const byUser = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLogs.forEach(l => {
      const uid = l.user_id?.slice(0, 8) || "system";
      map[uid] = (map[uid] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredLogs]);

  const exportCSV = () => {
    const headers = ["Date", "Action", "Resource", "Resource ID", "User ID", "IP", "Détails"];
    const rows = filteredLogs.map(l => [
      new Date(l.created_at).toLocaleString("fr-FR"),
      l.action,
      l.resource_type,
      l.resource_id || "",
      l.user_id || "",
      l.ip_address || "",
      `"${JSON.stringify(l.details || {}).replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_logs_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Monitoring Audit Logs
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Traçabilité complète des actions système pour conformité réglementaire
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(daysRange)} onValueChange={v => setDaysRange(Number(v))}>
            <SelectTrigger className="w-32 bg-secondary/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 jours</SelectItem>
              <SelectItem value="14">14 jours</SelectItem>
              <SelectItem value="30">30 jours</SelectItem>
              <SelectItem value="90">90 jours</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filteredLogs.length}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{filteredLogs.length}</p>
              <p className="text-xs text-muted-foreground">Actions enregistrées</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center">
              <Users className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold">{uniqueUsers.length}</p>
              <p className="text-xs text-muted-foreground">Utilisateurs actifs</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{uniqueActions.length}</p>
              <p className="text-xs text-muted-foreground">Types d'actions</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-destructive/15 flex items-center justify-center">
              <Clock className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {filteredLogs.length > 0 ? format(parseISO(filteredLogs[0].created_at), "HH:mm", { locale: fr }) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Dernière action</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Activité journalière</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={activityByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Actions" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Répartition par type d'action</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={byAction} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {byAction.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Par type de ressource</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byResource} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={100} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} name="Actions" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top 5 utilisateurs</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byUser}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Actions" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Logs table with filters */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Journal d'audit détaillé</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="pl-8 w-48 h-8 text-xs bg-secondary/50"
                />
              </div>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-36 h-8 text-xs bg-secondary/50">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes actions</SelectItem>
                  {uniqueActions.map(a => (
                    <SelectItem key={a} value={a}>{getActionLabel(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">Ressource</TableHead>
                  <TableHead className="text-xs">Utilisateur</TableHead>
                  <TableHead className="text-xs">Détails</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      Aucun log trouvé
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.slice(0, 100).map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(parseISO(log.created_at), "dd/MM/yy HH:mm", { locale: fr })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: ACTION_COLORS[log.action] || "hsl(var(--border))" }}
                        >
                          {getActionLabel(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{getResourceLabel(log.resource_type)}</TableCell>
                      <TableCell className="text-xs font-mono">{log.user_id?.slice(0, 8) || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate text-muted-foreground">
                        {log.details ? JSON.stringify(log.details).slice(0, 80) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
