import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = 'superadmin' | 'org_admin' | 'compliance_manager' | 'analyst' | 'forensic_analyst' | 'auditor' | 'read_only';

// Get the current user's role
export function useUserRole() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user_role", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.rpc("get_user_role", { _user_id: user.id });
      if (error) return "auditor" as AppRole;
      return (data || "auditor") as AppRole;
    },
  });
}

// List all user roles (admin only)
export function useAllUserRoles() {
  return useQuery({
    queryKey: ["all_user_roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// Assign a role
export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error("Non authentifié");
      const { data, error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role, assigned_by: currentUser.id }, { onConflict: "user_id,role" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all_user_roles"] }),
  });
}

// Revoke a role
export function useRevokeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all_user_roles"] }),
  });
}

// Invite user by email
export function useOrgInvitations() {
  return useQuery({
    queryKey: ["org_invitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_invitations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: AppRole }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");
      const { data, error } = await supabase
        .from("org_invitations")
        .insert({ email, role, invited_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org_invitations"] }),
  });
}

// Etherscan lookup
export function useEtherscanLookup() {
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (address: string, network: string = "ethereum") => {
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non authentifié");
      
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/etherscan-lookup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ address, network }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur API");
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  return { lookup, isLoading, data, error };
}

// Audit logs
export function useAuditLogs() {
  return useQuery({
    queryKey: ["audit_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateAuditLog() {
  return useMutation({
    mutationFn: async (log: { action: string; resource_type: string; resource_id?: string; details?: import("@/integrations/supabase/types").Json }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { error } = await supabase.from("audit_logs").insert([{ ...log, user_id: user.id }]);
      if (error) console.error("Audit log error:", error);
    },
  });
}
