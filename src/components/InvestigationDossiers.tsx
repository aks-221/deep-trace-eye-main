import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Plus, ChevronRight, Clock, AlertTriangle, CheckCircle2,
  Circle, FileText, Link2, MessageSquare, Shield, X, Save, ChevronDown,
  ChevronUp, Activity, User, Hash, Lock, Upload, Paperclip, Trash2, Download, Eye, File,
  AtSign, Send, Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---- Hooks ----
function useDossiers() {
  return useQuery({
    queryKey: ["dossiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("investigation_dossiers" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useDossierNotes(dossierId: string | null) {
  return useQuery({
    queryKey: ["dossier_notes", dossierId],
    enabled: !!dossierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dossier_notes" as any)
        .select("*")
        .eq("dossier_id", dossierId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useDossierDocuments(dossierId: string | null) {
  return useQuery({
    queryKey: ["dossier_documents", dossierId],
    enabled: !!dossierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dossier_documents" as any)
        .select("*")
        .eq("dossier_id", dossierId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useCreateDossier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { title: string; description?: string; status?: string; priority?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");
      const { data, error } = await supabase
        .from("investigation_dossiers" as any)
        .insert({ ...payload, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dossiers"] }),
  });
}

function useUpdateDossier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [k: string]: any }) => {
      const { data, error } = await supabase
        .from("investigation_dossiers" as any)
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dossiers"] }),
  });
}

function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { dossier_id: string; content: string; note_type?: string; metadata?: any }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");
      const { data, error } = await supabase
        .from("dossier_notes" as any)
        .insert({ ...payload, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["dossier_notes", vars.dossier_id] });
    },
  });
}

function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dossierId, file, description }: { dossierId: string; file: File; description?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const filePath = `${user.id}/${dossierId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("dossier-documents")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("dossier_documents" as any)
        .insert({
          dossier_id: dossierId,
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type,
          description: description || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["dossier_documents", vars.dossierId] });
    },
  });
}

function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, filePath, dossierId }: { id: string; filePath: string; dossierId: string }) => {
      await supabase.storage.from("dossier-documents").remove([filePath]);
      const { error } = await supabase.from("dossier_documents" as any).delete().eq("id", id);
      if (error) throw error;
      return dossierId;
    },
    onSuccess: (dossierId) => {
      qc.invalidateQueries({ queryKey: ["dossier_documents", dossierId] });
    },
  });
}

// ---- Constants ----
const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  open:        { label: "Ouvert",     icon: Circle,       color: "text-primary",     bg: "bg-primary/10 border-primary/30" },
  in_progress: { label: "En cours",   icon: Activity,     color: "text-accent",      bg: "bg-accent/10 border-accent/30" },
  closed:      { label: "Clôturé",    icon: CheckCircle2, color: "text-muted-foreground", bg: "bg-secondary/50 border-border" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low:      { label: "Faible",    color: "text-muted-foreground" },
  medium:   { label: "Moyen",     color: "text-accent" },
  high:     { label: "Élevé",     color: "text-destructive" },
  critical: { label: "Critique",  color: "text-destructive font-bold" },
};

const NOTE_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  note:          { label: "Note",           icon: MessageSquare, color: "text-muted-foreground" },
  action:        { label: "Action",         icon: Activity,      color: "text-primary" },
  status_change: { label: "Changement",     icon: Clock,         color: "text-accent" },
  evidence:      { label: "Preuve",         icon: Shield,        color: "text-destructive" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  return new Date(dateStr).toLocaleDateString("fr-FR");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return "🖼️";
  if (type.includes("pdf")) return "📄";
  if (type.includes("spreadsheet") || type.includes("excel") || type.includes("csv")) return "📊";
  if (type.includes("word") || type.includes("document")) return "📝";
  return "📎";
}

// ---- Document Upload Section ----
function DocumentsSection({ dossierId }: { dossierId: string }) {
  const { data: documents = [], isLoading } = useDossierDocuments(dossierId);
  const upload = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        toast({ title: "Fichier trop volumineux", description: `${file.name} dépasse 20 MB`, variant: "destructive" });
        continue;
      }
      try {
        await upload.mutateAsync({ dossierId, file });
        toast({ title: `📎 ${file.name} uploadé` });
      } catch (err: any) {
        toast({ title: "Erreur upload", description: err.message, variant: "destructive" });
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDownload = async (doc: any) => {
    const { data, error } = await supabase.storage.from("dossier-documents").download(doc.file_path);
    if (error) {
      toast({ title: "Erreur téléchargement", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (doc: any) => {
    try {
      await deleteDoc.mutateAsync({ id: doc.id, filePath: doc.file_path, dossierId });
      toast({ title: `🗑️ ${doc.file_name} supprimé` });
    } catch (err: any) {
      toast({ title: "Erreur suppression", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Paperclip className="h-3 w-3" /> Pièces justificatives ({documents.length})
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-3 w-3" />
          {uploading ? "Upload..." : "Ajouter"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.txt"
          onChange={handleFileSelect}
        />
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Chargement...</div>
      ) : documents.length === 0 ? (
        <div
          className="border border-dashed border-border rounded-lg py-4 text-center cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <File className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">Glissez ou cliquez pour ajouter des documents</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">PDF, Word, Excel, Images — Max 20 MB</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {documents.map((doc: any) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20 border border-border hover:bg-secondary/40 transition-colors group"
            >
              <span className="text-base flex-shrink-0">{getFileIcon(doc.file_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-foreground">{doc.file_name}</p>
                <p className="text-xs text-muted-foreground/60">
                  {formatFileSize(doc.file_size)} · {timeAgo(doc.created_at)}
                </p>
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDownload(doc)}>
                  <Download className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(doc)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Profiles hook for @mentions ----
function useProfiles() {
  return useQuery({
    queryKey: ["profiles_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .not("full_name", "is", null);
      if (error) throw error;
      return (data || []) as { user_id: string; full_name: string }[];
    },
    staleTime: 60000,
  });
}

// ---- Comments hook ----
function useDossierComments(dossierId: string | null) {
  return useQuery({
    queryKey: ["dossier_comments", dossierId],
    enabled: !!dossierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dossier_notes" as any)
        .select("*")
        .eq("dossier_id", dossierId!)
        .eq("note_type", "comment")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { dossier_id: string; content: string; metadata?: any }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const authorName = user.user_metadata?.full_name || user.email || "Utilisateur";

      // Extract @mentions from content
      const mentionRegex = /@([A-Za-zÀ-ÿ\s]+?)(?=\s@|\s[^@]|$)/g;
      const mentions: string[] = [];
      let match;
      while ((match = mentionRegex.exec(payload.content)) !== null) {
        mentions.push(match[1].trim());
      }

      const { data, error } = await supabase
        .from("dossier_notes" as any)
        .insert({
          dossier_id: payload.dossier_id,
          user_id: user.id,
          content: payload.content,
          note_type: "comment",
          metadata: { ...(payload.metadata || {}), mentions, author_name: authorName },
        })
        .select()
        .single();
      if (error) throw error;

      // Create notifications for mentioned users
      if (mentions.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .not("full_name", "is", null);

        if (profiles) {
          for (const mentionName of mentions) {
            const mentionedProfile = profiles.find(
              (p: any) => p.full_name?.toLowerCase() === mentionName.toLowerCase()
            );
            if (mentionedProfile && mentionedProfile.user_id !== user.id) {
              await supabase.from("notifications").insert({
                user_id: mentionedProfile.user_id,
                title: `💬 ${authorName} vous a mentionné`,
                body: `Dans le dossier d'investigation : "${payload.content.slice(0, 100)}${payload.content.length > 100 ? '...' : ''}"`,
                type: "compliance",
                metadata: {
                  module: "dossiers",
                  dossier_id: payload.dossier_id,
                  comment_author: authorName,
                  action: "Voir le dossier",
                },
              });
            }
          }
        }
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["dossier_comments", vars.dossier_id] });
      qc.invalidateQueries({ queryKey: ["dossier_notes", vars.dossier_id] });
    },
  });
}

// ---- Mention Input ----
function MentionInput({
  value,
  onChange,
  onSubmit,
  disabled,
  profiles,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  profiles: { user_id: string; full_name: string }[];
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredProfiles = profiles.filter((p) =>
    p.full_name.toLowerCase().includes(mentionQuery.toLowerCase())
  ).slice(0, 5);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart || 0;
    onChange(val);
    setCursorPos(pos);

    // Check if we're typing after @
    const textBeforeCursor = val.slice(0, pos);
    const atMatch = textBeforeCursor.match(/@([A-Za-zÀ-ÿ\s]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertMention = (name: string) => {
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    const newValue = value.slice(0, atIndex) + `@${name} ` + value.slice(cursorPos);
    onChange(newValue);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !showSuggestions) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ajouter un commentaire... Tapez @ pour mentionner"
        className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none pr-10"
        disabled={disabled}
      />
      <AnimatePresence>
        {showSuggestions && filteredProfiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-full left-0 mb-1 w-full bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
          >
            {filteredProfiles.map((p) => (
              <button
                key={p.user_id}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                onClick={() => insertMention(p.full_name)}
              >
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary flex-shrink-0">
                  {p.full_name.charAt(0).toUpperCase()}
                </div>
                <span className="text-foreground">{p.full_name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Render comment content with highlighted mentions ----
function CommentContent({ content }: { content: string }) {
  const parts = content.split(/(@[A-Za-zÀ-ÿ\s]+?)(?=\s@|\s[^@]|$)/g);
  return (
    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="text-primary font-medium bg-primary/10 rounded px-0.5">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

// ---- Comments Section ----
function CommentsSection({ dossierId }: { dossierId: string }) {
  const { data: comments = [], isLoading } = useDossierComments(dossierId);
  const { data: profiles = [] } = useProfiles();
  const addComment = useAddComment();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handleSubmit = async () => {
    if (!commentText.trim()) return;
    try {
      await addComment.mutateAsync({ dossier_id: dossierId, content: commentText.trim() });
      setCommentText("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Users className="h-3 w-3" /> Commentaires collaboratifs ({comments.length})
      </div>

      <div ref={scrollRef} className="max-h-48 overflow-y-auto border border-border rounded-lg bg-secondary/10 p-2 space-y-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Chargement...</div>
        ) : comments.length === 0 ? (
          <div className="py-6 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground/20 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Aucun commentaire — démarrez la discussion</p>
          </div>
        ) : (
          comments.map((c: any) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2 p-2 rounded-lg hover:bg-secondary/30 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0 mt-0.5">
                {(c.metadata?.author_name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-semibold text-foreground">{c.metadata?.author_name || "Utilisateur"}</span>
                  <span className="text-xs text-muted-foreground/50">·</span>
                  <span className="text-xs text-muted-foreground/60">{timeAgo(c.created_at)}</span>
                </div>
                <CommentContent content={c.content} />
                {c.metadata?.mentions?.length > 0 && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {c.metadata.mentions.map((m: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs h-4 px-1.5 bg-primary/5 text-primary border-primary/20">
                        <AtSign className="h-2.5 w-2.5 mr-0.5" />{m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <MentionInput
            value={commentText}
            onChange={setCommentText}
            onSubmit={handleSubmit}
            disabled={addComment.isPending}
            profiles={profiles}
          />
        </div>
        <Button
          size="sm"
          className="h-10 w-10 p-0 flex-shrink-0"
          onClick={handleSubmit}
          disabled={!commentText.trim() || addComment.isPending}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---- Create Dossier Dialog ----
function CreateDossierDialog({ open, onClose, prefillTxRef }: { open: boolean; onClose: (id?: string) => void; prefillTxRef?: string }) {
  const { toast } = useToast();
  const create = useCreateDossier();
  const [form, setForm] = useState({ title: prefillTxRef ? `Investigation ${prefillTxRef}` : "", description: "", status: "open", priority: "medium" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    try {
      const dossier = await create.mutateAsync(form) as any;
      toast({ title: "✅ Dossier créé" });
      onClose(dossier?.id);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            Nouveau dossier d'investigation
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Titre *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Investigation TX-CRYPTO-001" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="resize-none" placeholder="Contexte et objectifs de l'investigation..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priorité</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Statut initial</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={create.isPending}>
              <FolderOpen className="h-4 w-4 mr-1.5" />
              Créer le dossier
            </Button>
            <Button type="button" variant="outline" onClick={() => onClose()}><X className="h-4 w-4" /></Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Dossier Detail Panel ----
function DossierDetail({ dossier, onClose, onStatusChange }: { dossier: any; onClose: () => void; onStatusChange: (id: string, status: string) => void }) {
  const { data: notes = [] } = useDossierNotes(dossier.id);
  const addNote = useAddNote();
  const { toast } = useToast();
  const [noteContent, setNoteContent] = useState("");
  const [noteType, setNoteType] = useState("note");
  const [showDocs, setShowDocs] = useState(true);

  const statusInfo = STATUS_CONFIG[dossier.status] || STATUS_CONFIG.open;
  const priorityInfo = PRIORITY_CONFIG[dossier.priority] || PRIORITY_CONFIG.medium;
  const StatusIcon = statusInfo.icon;

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    try {
      await addNote.mutateAsync({ dossier_id: dossier.id, content: noteContent.trim(), note_type: noteType });
      setNoteContent("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const nextStatus: Record<string, string> = { open: "in_progress", in_progress: "closed", closed: "open" };
  const nextStatusLabel: Record<string, string> = { open: "Démarrer l'investigation", in_progress: "Clôturer le dossier", closed: "Rouvrir le dossier" };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={`text-xs ${statusInfo.bg} ${statusInfo.color} border`}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusInfo.label}
            </Badge>
            <Badge variant="outline" className={`text-xs ${priorityInfo.color}`}>
              {priorityInfo.label}
            </Badge>
          </div>
          <h3 className="font-bold text-base text-foreground leading-tight">{dossier.title}</h3>
          {dossier.description && <p className="text-xs text-muted-foreground mt-1">{dossier.description}</p>}
          <div className="flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground/60">Créé {timeAgo(dossier.created_at)}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Status change button */}
      {dossier.status !== "closed" && (
        <Button
          variant="outline"
          size="sm"
          className="mb-3 w-full gap-1.5 justify-start"
          onClick={() => onStatusChange(dossier.id, nextStatus[dossier.status])}
        >
          <Activity className="h-3.5 w-3.5 text-primary" />
          {nextStatusLabel[dossier.status]}
        </Button>
      )}

      {/* Documents section */}
      <div className="mb-3 border border-border rounded-lg p-3 bg-secondary/10">
        <button
          onClick={() => setShowDocs(v => !v)}
          className="flex items-center justify-between w-full text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          <span className="flex items-center gap-1.5">
            <Paperclip className="h-3 w-3" /> Pièces justificatives
          </span>
          {showDocs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showDocs && (
          <div className="mt-2">
            <DocumentsSection dossierId={dossier.id} />
          </div>
        )}
      </div>

      {/* Comments section */}
      <div className="mb-3 border border-border rounded-lg p-3 bg-secondary/10">
        <CommentsSection dossierId={dossier.id} />
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> Chronologie
        </div>
        <ScrollArea className="flex-1 border border-border rounded-lg bg-secondary/10">
          {notes.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Aucune note — commencez l'investigation</div>
          ) : (
            <div className="p-3 space-y-3">
              {notes.map((note: any) => {
                const typeInfo = NOTE_TYPE_CONFIG[note.note_type] || NOTE_TYPE_CONFIG.note;
                const TypeIcon = typeInfo.icon;
                return (
                  <div key={note.id} className="flex gap-2.5">
                    <div className={`mt-0.5 w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center bg-card border border-border`}>
                      <TypeIcon className={`h-3.5 w-3.5 ${typeInfo.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-xs font-medium ${typeInfo.color}`}>{typeInfo.label}</span>
                        <span className="text-xs text-muted-foreground/50">·</span>
                        <span className="text-xs text-muted-foreground/60">{timeAgo(note.created_at)}</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                      {note.metadata && (
                        <div className="mt-1 flex gap-1.5 flex-wrap">
                          {note.metadata.txRef && <Badge variant="outline" className="text-xs h-4 px-1.5">Réf: {note.metadata.txRef}</Badge>}
                          {note.metadata.address && <Badge variant="outline" className="text-xs h-4 px-1.5 font-mono">{note.metadata.address.slice(0, 12)}…</Badge>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Add note form */}
        <form onSubmit={handleAddNote} className="mt-3 space-y-2">
          <div className="flex gap-2">
            <Select value={noteType} onValueChange={setNoteType}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(NOTE_TYPE_CONFIG).map(([v, c]) => (
                  <SelectItem key={v} value={v} className="text-xs">{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground self-center">Type de note</span>
          </div>
          <div className="flex gap-2">
            <Textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder="Ajouter une note, preuve ou action..."
              className="flex-1 resize-none h-16 text-sm"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddNote(e as any); } }}
            />
            <Button type="submit" size="sm" disabled={!noteContent.trim() || addNote.isPending} className="self-end h-10 w-10 p-0">
              <Save className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

// ---- Dossier Card ----
function DossierCard({ dossier, active, onClick }: { dossier: any; active: boolean; onClick: () => void }) {
  const statusInfo = STATUS_CONFIG[dossier.status] || STATUS_CONFIG.open;
  const priorityInfo = PRIORITY_CONFIG[dossier.priority] || PRIORITY_CONFIG.medium;
  const StatusIcon = statusInfo.icon;

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
        active
          ? "bg-primary/10 border-primary/40 shadow-sm"
          : "bg-card/50 border-border hover:border-primary/20 hover:bg-card/80"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${statusInfo.bg}`}>
          <StatusIcon className={`h-4 w-4 ${statusInfo.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <p className="font-medium text-sm text-foreground leading-snug line-clamp-2">{dossier.title}</p>
            <ChevronRight className={`h-4 w-4 flex-shrink-0 mt-0.5 transition-colors ${active ? "text-primary" : "text-muted-foreground/40"}`} />
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <Badge variant="outline" className={`text-xs px-1.5 py-0 h-4 ${statusInfo.bg} ${statusInfo.color} border`}>{statusInfo.label}</Badge>
            <Badge variant="outline" className={`text-xs px-1.5 py-0 h-4 ${priorityInfo.color}`}>{priorityInfo.label}</Badge>
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground/50">{timeAgo(dossier.created_at)}</span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

// ---- Main Component ----
export default function InvestigationDossiers() {
  const { toast } = useToast();
  const { data: dossiers = [], isLoading } = useDossiers();
  const updateDossier = useUpdateDossier();
  const addNote = useAddNote();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");

  const selectedDossier = dossiers.find((d: any) => d.id === selectedId);

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await updateDossier.mutateAsync({
        id,
        status: newStatus,
        ...(newStatus === "closed" ? { closed_at: new Date().toISOString() } : {}),
      });
      await addNote.mutateAsync({
        dossier_id: id,
        content: `Statut changé vers: ${STATUS_CONFIG[newStatus]?.label || newStatus}`,
        note_type: "status_change",
      });
      toast({ title: `Dossier ${STATUS_CONFIG[newStatus]?.label || newStatus}` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const filtered = filterStatus === "all" ? dossiers : dossiers.filter((d: any) => d.status === filterStatus);

  const counts = {
    open: dossiers.filter((d: any) => d.status === "open").length,
    in_progress: dossiers.filter((d: any) => d.status === "in_progress").length,
    closed: dossiers.filter((d: any) => d.status === "closed").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" />
            Dossiers d'Investigation
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">Suivez vos investigations AML avec historique complet et pièces justificatives</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nouveau dossier
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total", value: dossiers.length, color: "text-foreground" },
          { label: "Ouverts", value: counts.open, color: "text-primary" },
          { label: "En cours", value: counts.in_progress, color: "text-accent" },
          { label: "Clôturés", value: counts.closed, color: "text-muted-foreground" },
        ].map(s => (
          <Card key={s.label} className="bg-card/50 border-border">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { value: "all", label: `Tous (${dossiers.length})` },
          { value: "open", label: `Ouverts (${counts.open})` },
          { value: "in_progress", label: `En cours (${counts.in_progress})` },
          { value: "closed", label: `Clôturés (${counts.closed})` },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilterStatus(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filterStatus === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Split view */}
      <div className="grid grid-cols-12 gap-4 min-h-[500px]">
        {/* Left: list */}
        <div className={`${selectedDossier ? "col-span-5" : "col-span-12"} space-y-2`}>
          {isLoading ? (
            <div className="text-muted-foreground text-sm py-8 text-center">Chargement...</div>
          ) : filtered.length === 0 ? (
            <Card className="bg-card/50 border-dashed border-border">
              <CardContent className="py-14 text-center">
                <FolderOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Aucun dossier {filterStatus !== "all" ? `(${STATUS_CONFIG[filterStatus]?.label})` : ""}</p>
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setShowCreate(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Créer un dossier
                </Button>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence mode="popLayout">
              {filtered.map((d: any) => (
                <DossierCard
                  key={d.id}
                  dossier={d}
                  active={selectedId === d.id}
                  onClick={() => setSelectedId(selectedId === d.id ? null : d.id)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Right: detail panel */}
        <AnimatePresence>
          {selectedDossier && (
            <motion.div
              key={selectedDossier.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="col-span-7 bg-card/50 border border-border rounded-xl p-4 flex flex-col"
              style={{ minHeight: 500 }}
            >
              <DossierDetail
                dossier={selectedDossier}
                onClose={() => setSelectedId(null)}
                onStatusChange={handleStatusChange}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <CreateDossierDialog open={showCreate} onClose={(id) => { setShowCreate(false); if (id) setSelectedId(id); }} />
    </div>
  );
}
