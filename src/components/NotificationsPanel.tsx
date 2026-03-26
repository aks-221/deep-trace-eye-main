import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellOff, Check, CheckCheck, X, AlertTriangle, Zap, Shield, Clock, FileText, Filter, Download, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const NOTIF_FILTERS = [
  { key: "all", label: "Toutes", icon: Bell },
  { key: "critical_aml", label: "AML Critique", icon: Zap },
  { key: "compliance", label: "Compliance", icon: Shield },
  { key: "weekly_report", label: "Rapports", icon: FileText },
  { key: "reminder_alert", label: "Rappels", icon: Clock },
] as const;

type NotifFilterKey = typeof NOTIF_FILTERS[number]["key"];

function getNotifIcon(type: string) {
  switch (type) {
    case "critical_aml": return <Zap className="h-4 w-4 text-destructive" />;
    case "batch_alert":  return <AlertTriangle className="h-4 w-4 text-accent" />;
    case "compliance":   return <Shield className="h-4 w-4 text-primary" />;
    case "weekly_report": return <FileText className="h-4 w-4 text-emerald-400" />;
    case "reminder_alert": return <Clock className="h-4 w-4 text-accent" />;
    default:             return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)  return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `Il y a ${h}h`;
  return new Date(dateStr).toLocaleDateString("fr-FR");
}

export default function NotificationsPanel({ onNavigate }: { onNavigate?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotifFilterKey>("all");
  const [pushEnabled, setPushEnabled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // Check push notification permission
  useEffect(() => {
    if ("Notification" in window) {
      setPushEnabled(Notification.permission === "granted");
    }
  }, []);

  // Send browser push for critical notifications
  useEffect(() => {
    if (!pushEnabled) return;
    const channel = supabase
      .channel("push-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload: any) => {
          const n = payload.new;
          if (n && (n.type === "critical_aml" || n.type === "compliance")) {
            try {
              new Notification(n.title || "DeepAuditAI", {
                body: n.body || "",
                icon: "/favicon.ico",
                tag: n.id,
              });
            } catch {}
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pushEnabled]);

  const requestPushPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      toast({ title: "Notifications push non supportées", description: "Votre navigateur ne supporte pas les notifications push.", variant: "destructive" });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setPushEnabled(true);
      toast({ title: "🔔 Notifications push activées", description: "Vous recevrez des alertes pour les notifications critiques." });
      new Notification("DeepAuditAI", { body: "Notifications push activées !", icon: "/favicon.ico" });
    } else {
      toast({ title: "Notifications push refusées", variant: "destructive" });
    }
  }, [toast]);

  const unreadCount = notifications.filter((n: any) => !n.read).length;

  const filteredNotifications = useMemo(() => {
    if (activeFilter === "all") return notifications;
    return notifications.filter((n: any) => n.type === activeFilter);
  }, [notifications, activeFilter]);

  const exportCSV = useCallback(async () => {
    const data = filteredNotifications;
    if (!data.length) return;
    const headers = ["Date", "Type", "Titre", "Corps", "Lu", "Réf", "Score"];
    const rows = data.map((n: any) => [
      new Date(n.created_at).toLocaleString("fr-FR"),
      n.type || "",
      `"${(n.title || "").replace(/"/g, '""')}"`,
      `"${(n.body || "").replace(/"/g, '""')}"`,
      n.read ? "Oui" : "Non",
      n.metadata?.txRef || "",
      n.metadata?.riskScore ?? "",
    ]);
    const csv = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = `notifications_${activeFilter}_${new Date().toISOString().slice(0,10)}.csv`;
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "📥 Export CSV téléchargé", description: `${data.length} notification(s) exportée(s)` });

    // Audit log for CSV export
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("audit_logs").insert({
          user_id: user.id,
          action: "export_csv",
          resource_type: "notifications",
          details: {
            filter: activeFilter,
            count: data.length,
            filename,
            exported_at: new Date().toISOString(),
          },
        });
      }
    } catch (e) {
      console.error("Audit log error:", e);
    }
  }, [filteredNotifications, activeFilter, toast]);

  // Realtime subscription for new notifications
  useEffect(() => {
    const channel = supabase
      .channel("notifications-panel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-secondary/60 transition-colors"
        aria-label="Notifications"
      >
        <Bell className={`h-5 w-5 ${unreadCount > 0 ? "text-accent" : "text-muted-foreground"}`} />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold shadow"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-11 w-96 bg-card border border-border rounded-xl shadow-2xl z-[200] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Notifications</span>
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="text-xs px-1.5 py-0.5">{unreadCount} nouvelles</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!pushEnabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={requestPushPermission}
                    title="Activer les notifications push"
                  >
                    <BellRing className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                {filteredNotifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={exportCSV}
                    title="Exporter CSV"
                  >
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => markAllRead.mutate()}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Tout lire
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-card/50 overflow-x-auto">
              {NOTIF_FILTERS.map(f => {
                const Icon = f.icon;
                const count = f.key === "all"
                  ? notifications.length
                  : notifications.filter((n: any) => n.type === f.key).length;
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      activeFilter === f.key
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-secondary/40"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {f.label}
                    {count > 0 && (
                      <span className={`ml-0.5 text-xs ${activeFilter === f.key ? "text-primary" : "text-muted-foreground/60"}`}>
                        ({count})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* List */}
            <ScrollArea className="h-[380px]">
              {filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                  <BellOff className="h-8 w-8 mb-2 opacity-40" />
                  <span className="text-sm">{activeFilter === "all" ? "Aucune notification" : "Aucune notification de ce type"}</span>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredNotifications.map((notif: any) => (
                    <motion.div
                      key={notif.id}
                      layout
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-secondary/30 ${
                        !notif.read ? "bg-primary/5 border-l-2 border-l-primary" : ""
                      }`}
                      onClick={() => {
                        if (!notif.read) markRead.mutate(notif.id);
                        if (notif.metadata?.module && onNavigate) {
                          onNavigate(notif.metadata.module);
                          setOpen(false);
                        }
                      }}
                    >
                      {/* Icon */}
                      <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        notif.type === "critical_aml"
                          ? "bg-destructive/15"
                          : notif.type === "batch_alert"
                          ? "bg-accent/15"
                          : notif.type === "weekly_report"
                          ? "bg-primary/10"
                          : "bg-primary/10"
                      }`}>
                        {getNotifIcon(notif.type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium leading-snug ${!notif.read ? "text-foreground" : "text-muted-foreground"}`}>
                            {notif.title}
                          </p>
                          {!notif.read && (
                            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" />
                          )}
                        </div>
                        {notif.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                        )}
                        {notif.metadata && (
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {notif.metadata.txRef && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                                Réf: {notif.metadata.txRef}
                              </Badge>
                            )}
                            {notif.metadata.riskScore !== undefined && (
                              <Badge
                                variant={notif.metadata.riskScore >= 70 ? "destructive" : "secondary"}
                                className="text-xs px-1.5 py-0 h-5"
                              >
                                Score: {notif.metadata.riskScore}/100
                              </Badge>
                            )}
                            {notif.metadata.action && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 text-accent border-accent/30">
                                {notif.metadata.action}
                              </Badge>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground/60" />
                          <span className="text-xs text-muted-foreground/60">{timeAgo(notif.created_at)}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            {filteredNotifications.length > 0 && (
              <div className="px-4 py-2 border-t border-border bg-card/50 text-xs text-muted-foreground text-center">
                {filteredNotifications.length} notification{filteredNotifications.length > 1 ? "s" : ""}
                {activeFilter !== "all" && ` · filtre: ${NOTIF_FILTERS.find(f => f.key === activeFilter)?.label}`}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
