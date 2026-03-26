import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Shield, Zap, AlertTriangle,
  TrendingUp, Filter, ChevronDown, ChevronUp, Save, X, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAMLRules, useCreateAMLRule, useUpdateAMLRule, useDeleteAMLRule } from "@/hooks/useSupabaseData";
import type { AppRole } from "@/hooks/useRBAC";

const RULE_TYPES = [
  { value: "threshold",  label: "Seuil de montant",     icon: TrendingUp,     color: "text-primary" },
  { value: "channel",    label: "Canal suspect",         icon: Filter,         color: "text-accent" },
  { value: "typology",   label: "Typologie / Mots-clés", icon: AlertTriangle,  color: "text-destructive" },
  { value: "velocity",   label: "Vélocité (fréquence)",  icon: Zap,            color: "text-amber-500" },
];

const SCORE_ACTIONS = [
  { value: "surveiller",    label: "🔍 Surveiller",      color: "bg-primary/15 text-primary border-primary/30" },
  { value: "signaler",      label: "⚠️ Signaler",         color: "bg-accent/15 text-accent border-accent/30" },
  { value: "declarer_STR",  label: "📋 Déclarer STR",    color: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  { value: "bloquer",       label: "🚫 Bloquer",          color: "bg-destructive/15 text-destructive border-destructive/30" },
];

const CHANNELS = ["Bank", "Mobile Money", "Crypto", "Cash", "Wire Transfer", "Western Union", "Other"];
const OPERATORS = [
  { value: ">",  label: "Supérieur à (>)" },
  { value: ">=", label: "Supérieur ou égal (≥)" },
  { value: "<",  label: "Inférieur à (<)" },
  { value: "<=", label: "Inférieur ou égal (≤)" },
  { value: "=",  label: "Égal à (=)" },
];

function emptyRule() {
  return {
    name: "",
    description: "",
    rule_type: "threshold",
    enabled: true,
    priority: 5,
    amount_threshold: "",
    amount_operator: ">",
    target_channels: [] as string[],
    typology_keywords: "",
    velocity_count: "",
    velocity_window_hours: 24,
    score_impact: 15,
    score_action: "signaler",
  };
}

function getRuleTypeInfo(type: string) {
  return RULE_TYPES.find(r => r.value === type) || RULE_TYPES[0];
}
function getActionInfo(action: string) {
  return SCORE_ACTIONS.find(a => a.value === action) || SCORE_ACTIONS[0];
}

function RuleFormDialog({
  open, onClose, existing,
}: { open: boolean; onClose: () => void; existing?: any }) {
  const { toast } = useToast();
  const create = useCreateAMLRule();
  const update = useUpdateAMLRule();
  const [form, setForm] = useState(existing ? {
    name: existing.name,
    description: existing.description || "",
    rule_type: existing.rule_type,
    enabled: existing.enabled,
    priority: existing.priority,
    amount_threshold: existing.amount_threshold ?? "",
    amount_operator: existing.amount_operator || ">",
    target_channels: existing.target_channels || [],
    typology_keywords: (existing.typology_keywords || []).join(", "),
    velocity_count: existing.velocity_count ?? "",
    velocity_window_hours: existing.velocity_window_hours || 24,
    score_impact: existing.score_impact,
    score_action: existing.score_action,
  } : emptyRule());

  const isEditing = !!existing;

  const set = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  const toggleChannel = (ch: string) => {
    setForm(f => ({
      ...f,
      target_channels: (f.target_channels as string[]).includes(ch)
        ? (f.target_channels as string[]).filter(c => c !== ch)
        : [...(f.target_channels as string[]), ch],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Nom requis", variant: "destructive" });
      return;
    }

    const payload: any = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      rule_type: form.rule_type,
      enabled: form.enabled,
      priority: Number(form.priority),
      score_impact: Number(form.score_impact),
      score_action: form.score_action,
    };

    if (form.rule_type === "threshold") {
      payload.amount_threshold = form.amount_threshold ? Number(form.amount_threshold) : undefined;
      payload.amount_operator = form.amount_operator;
    }
    if (form.rule_type === "channel") {
      payload.target_channels = form.target_channels;
    }
    if (form.rule_type === "typology") {
      payload.typology_keywords = (form.typology_keywords as string).split(",").map((k: string) => k.trim()).filter(Boolean);
    }
    if (form.rule_type === "velocity") {
      payload.velocity_count = form.velocity_count ? Number(form.velocity_count) : undefined;
      payload.velocity_window_hours = Number(form.velocity_window_hours);
    }

    try {
      if (isEditing) {
        await update.mutateAsync({ id: existing.id, ...payload });
        toast({ title: "✅ Règle mise à jour" });
      } else {
        await create.mutateAsync(payload);
        toast({ title: "✅ Règle créée" });
      }
      onClose();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {isEditing ? "Modifier la règle AML" : "Nouvelle règle AML"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Basic info */}
          <div className="space-y-2">
            <Label>Nom de la règle *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Ex: Seuil BCEAO 5M XOF" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} placeholder="Décrivez l'objectif de cette règle..." className="resize-none" />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label>Type de règle</Label>
            <Select value={form.rule_type} onValueChange={v => set("rule_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map(r => (
                  <SelectItem key={r.value} value={r.value}>
                    <span className="flex items-center gap-2">
                      <r.icon className={`h-4 w-4 ${r.color}`} />
                      {r.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conditional fields */}
          {form.rule_type === "threshold" && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
              <div className="space-y-1.5">
                <Label className="text-xs">Opérateur</Label>
                <Select value={form.amount_operator} onValueChange={v => set("amount_operator", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Montant (XOF)</Label>
                <Input type="number" min={0} value={form.amount_threshold} onChange={e => set("amount_threshold", e.target.value)} placeholder="Ex: 5000000" className="h-9" />
              </div>
            </div>
          )}

          {form.rule_type === "channel" && (
            <div className="p-3 rounded-lg bg-secondary/30 border border-border">
              <Label className="text-xs mb-2 block">Canaux suspects (sélectionner)</Label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map(ch => (
                  <button
                    key={ch} type="button"
                    onClick={() => toggleChannel(ch)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      (form.target_channels as string[]).includes(ch)
                        ? "bg-accent text-accent-foreground border-accent"
                        : "bg-background text-muted-foreground border-border hover:border-accent/50"
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.rule_type === "typology" && (
            <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-1.5">
              <Label className="text-xs">Mots-clés (séparés par virgules)</Label>
              <Input value={form.typology_keywords as string} onChange={e => set("typology_keywords", e.target.value)} placeholder="structuration, casino, hawala, smurfing" />
              <p className="text-xs text-muted-foreground">Ces mots seront recherchés dans les notes/références des transactions.</p>
            </div>
          )}

          {form.rule_type === "velocity" && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
              <div className="space-y-1.5">
                <Label className="text-xs">Nb de transactions</Label>
                <Input type="number" min={1} value={form.velocity_count} onChange={e => set("velocity_count", e.target.value)} placeholder="Ex: 5" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fenêtre (heures)</Label>
                <Input type="number" min={1} value={form.velocity_window_hours} onChange={e => set("velocity_window_hours", e.target.value)} placeholder="Ex: 24" className="h-9" />
              </div>
            </div>
          )}

          {/* Score impact & action */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Impact sur le score (+)</Label>
              <Input type="number" min={1} max={100} value={form.score_impact} onChange={e => set("score_impact", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Action recommandée</Label>
              <Select value={form.score_action} onValueChange={v => set("score_action", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCORE_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Priority & enabled */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Priorité (1=haute)</Label>
              <Input type="number" min={1} max={10} value={form.priority} onChange={e => set("priority", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Statut</Label>
              <button
                type="button"
                onClick={() => set("enabled", !form.enabled)}
                className={`w-full h-10 rounded-md border flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                  form.enabled
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-secondary/50 border-border text-muted-foreground"
                }`}
              >
                {form.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                {form.enabled ? "Activée" : "Désactivée"}
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={create.isPending || update.isPending}>
              <Save className="h-4 w-4 mr-1.5" />
              {isEditing ? "Enregistrer" : "Créer la règle"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleCard({ rule, onEdit, onDelete, onToggle }: {
  rule: any; onEdit: (r: any) => void; onDelete: (id: string) => void; onToggle: (id: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = getRuleTypeInfo(rule.rule_type);
  const actionInfo = getActionInfo(rule.score_action);
  const Icon = typeInfo.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <Card className={`border-border bg-card/50 transition-all ${!rule.enabled ? "opacity-60" : ""}`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-secondary/40`}>
              <Icon className={`h-4 w-4 ${typeInfo.color}`} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-semibold text-sm ${rule.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                  {rule.name}
                </span>
                <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 border ${actionInfo.color}`}>
                  {actionInfo.label}
                </Badge>
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                  +{rule.score_impact} pts
                </Badge>
                <Badge variant={rule.enabled ? "default" : "outline"} className="text-xs px-1.5 py-0 h-5 ml-auto">
                  P{rule.priority}
                </Badge>
              </div>

              {rule.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rule.description}</p>
              )}

              {/* Rule params summary */}
              <div className="flex gap-1.5 flex-wrap mt-2">
                {rule.rule_type === "threshold" && rule.amount_threshold && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    Montant {rule.amount_operator} {new Intl.NumberFormat("fr-FR").format(rule.amount_threshold)} XOF
                  </span>
                )}
                {rule.rule_type === "channel" && rule.target_channels?.length > 0 && rule.target_channels.map((ch: string) => (
                  <span key={ch} className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">{ch}</span>
                ))}
                {rule.rule_type === "typology" && rule.typology_keywords?.length > 0 && rule.typology_keywords.slice(0, 3).map((k: string) => (
                  <span key={k} className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">{k}</span>
                ))}
                {rule.rule_type === "velocity" && rule.velocity_count && (
                  <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                    {rule.velocity_count} tx / {rule.velocity_window_hours}h
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onToggle(rule.id, !rule.enabled)}
                className={`p-1.5 rounded-md transition-colors ${rule.enabled ? "hover:bg-destructive/10 text-primary" : "hover:bg-primary/10 text-muted-foreground"}`}
                title={rule.enabled ? "Désactiver" : "Activer"}
              >
                {rule.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
              </button>
              <button onClick={() => onEdit(rule)} className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground transition-colors">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => onDelete(rule.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
              <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground transition-colors">
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Expanded details */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Type:</span> {typeInfo.label}</div>
                  <div><span className="font-medium text-foreground">Priorité:</span> {rule.priority}</div>
                  <div><span className="font-medium text-foreground">Impact score:</span> +{rule.score_impact} pts</div>
                  <div><span className="font-medium text-foreground">Créée le:</span> {new Date(rule.created_at).toLocaleDateString("fr-FR")}</div>
                  {rule.description && (
                    <div className="col-span-2"><span className="font-medium text-foreground">Description:</span> {rule.description}</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface AMLRulesEngineProps {
  userRole?: AppRole | null;
}

export default function AMLRulesEngine({ userRole }: AMLRulesEngineProps) {
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useAMLRules();
  const deleteRule = useDeleteAMLRule();
  const updateRule = useUpdateAMLRule();

  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [filterType, setFilterType] = useState("all");

  const canManage = userRole === "superadmin" || userRole === "org_admin" || userRole === "compliance_manager";

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette règle AML ?")) return;
    try {
      await deleteRule.mutateAsync(id);
      toast({ title: "Règle supprimée" });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await updateRule.mutateAsync({ id, enabled });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const filtered = filterType === "all" ? rules : rules.filter((r: any) => r.rule_type === filterType);
  const enabledCount = rules.filter((r: any) => r.enabled).length;

  // Apply rules to a transaction (exported logic for scoring)
  const applyRulesToTx = (tx: any) => {
    let totalImpact = 0;
    const triggeredRules: any[] = [];
    const enabledRules = rules.filter((r: any) => r.enabled);
    for (const rule of enabledRules) {
      let triggered = false;
      if (rule.rule_type === "threshold" && rule.amount_threshold) {
        const amt = Number(tx.amount);
        const thresh = Number(rule.amount_threshold);
        const op = rule.amount_operator || ">";
        triggered = op === ">" ? amt > thresh
          : op === ">=" ? amt >= thresh
          : op === "<" ? amt < thresh
          : op === "<=" ? amt <= thresh
          : amt === thresh;
      } else if (rule.rule_type === "channel" && rule.target_channels?.length) {
        triggered = rule.target_channels.includes(tx.channel);
      } else if (rule.rule_type === "typology" && rule.typology_keywords?.length) {
        const text = `${tx.ref || ""} ${tx.notes || ""}`.toLowerCase();
        triggered = rule.typology_keywords.some((k: string) => text.includes(k.toLowerCase()));
      }
      if (triggered) {
        totalImpact += rule.score_impact;
        triggeredRules.push(rule);
      }
    }
    return { totalImpact: Math.min(totalImpact, 100), triggeredRules };
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Moteur de règles AML
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Règles personnalisées appliquées au scoring de chaque transaction
          </p>
        </div>
        {canManage && (
          <Button onClick={() => { setEditingRule(null); setShowForm(true); }} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouvelle règle
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Règles actives", value: enabledCount, color: "text-primary" },
          { label: "Total règles", value: rules.length, color: "text-foreground" },
          { label: "Règles seuil", value: rules.filter((r: any) => r.rule_type === "threshold").length, color: "text-accent" },
          { label: "Score max cumulé", value: rules.filter((r: any) => r.enabled).reduce((a: number, r: any) => a + r.score_impact, 0) + " pts", color: "text-destructive" },
        ].map(s => (
          <Card key={s.label} className="bg-card/50 border-border">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Info banner for non-managers */}
      {!canManage && (
        <div className="flex items-start gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm">
          <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <span className="text-muted-foreground">
            Vous êtes en lecture seule. Seuls les <strong>Compliance Manager</strong>, <strong>Org Admin</strong> et <strong>Superadmin</strong> peuvent créer ou modifier des règles AML.
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[{ value: "all", label: "Toutes" }, ...RULE_TYPES.map(r => ({ value: r.value, label: r.label }))].map(f => (
          <button
            key={f.value}
            onClick={() => setFilterType(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filterType === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1 opacity-60">
                ({rules.filter((r: any) => r.rule_type === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Rules list */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Chargement des règles...</div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card/50 border-border border-dashed">
          <CardContent className="py-14 text-center">
            <Shield className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm font-medium">
              {filterType === "all" ? "Aucune règle AML configurée" : "Aucune règle de ce type"}
            </p>
            {canManage && filterType === "all" && (
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setShowForm(true)}>
                <Plus className="h-3.5 w-3.5" />
                Créer la première règle
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="grid gap-3">
            {filtered.map((rule: any) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={(r) => { setEditingRule(r); setShowForm(true); }}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Form dialog */}
      <RuleFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditingRule(null); }}
        existing={editingRule}
      />
    </div>
  );
}

// Export the rule application logic for use in scoring
export function applyCustomRules(tx: any, rules: any[]): { impact: number; triggeredRules: any[] } {
  let impact = 0;
  const triggeredRules: any[] = [];
  const enabledRules = rules.filter(r => r.enabled);
  for (const rule of enabledRules) {
    let triggered = false;
    if (rule.rule_type === "threshold" && rule.amount_threshold) {
      const amt = Number(tx.amount);
      const thresh = Number(rule.amount_threshold);
      const op = rule.amount_operator || ">";
      triggered = op === ">" ? amt > thresh : op === ">=" ? amt >= thresh : op === "<" ? amt < thresh : op === "<=" ? amt <= thresh : amt === thresh;
    } else if (rule.rule_type === "channel" && rule.target_channels?.length) {
      triggered = rule.target_channels.includes(tx.channel);
    } else if (rule.rule_type === "typology" && rule.typology_keywords?.length) {
      const text = `${tx.ref || ""} ${tx.notes || ""}`.toLowerCase();
      triggered = rule.typology_keywords.some((k: string) => text.includes(k.toLowerCase()));
    }
    if (triggered) {
      impact += rule.score_impact;
      triggeredRules.push(rule);
    }
  }
  return { impact: Math.min(impact, 100), triggeredRules };
}
