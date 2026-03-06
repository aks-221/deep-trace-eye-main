import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "@/hooks/useSupabaseData";
import { useAuth } from "@/hooks/useAuth";

/**
 * Redirects freshly-signed-up users who haven't set their full_name yet to /onboarding.
 * Must be used inside a ProtectedRoute so `user` is guaranteed non-null.
 */
export default function OnboardingGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const navigate = useNavigate();

  useEffect(() => {
    // Wait until profile is fetched before deciding
    if (isLoading || !user) return;
    // If profile exists and has a full_name, user is onboarded
    if (profile && profile.full_name) return;
    // New user or profile without name → onboarding
    navigate("/onboarding", { replace: true });
  }, [profile, isLoading, user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Vérification du profil...</div>
      </div>
    );
  }

  return <>{children}</>;
}
