import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/useLanguage";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon, Languages } from "lucide-react";
import logo from "@/assets/logo.png";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) throw error;
        navigate("/");
      } else {
        const { error } = await signUp(email, password, fullName);
        if (error) throw error;
        toast({
          title: language === "fr" ? "Compte créé" : "Account created",
          description: language === "fr" ? "Vérifiez votre email pour confirmer votre compte." : "Check your email to confirm your account.",
        });
        setMode("login");
      }
    } catch (err: any) {
      toast({
        title: t("common.error"),
        description: err.message || (language === "fr" ? "Une erreur est survenue" : "An error occurred"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Top controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 gap-1 text-xs"
          onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
        >
          <Languages className="h-3.5 w-3.5" />
          {language === "fr" ? "EN" : "FR"}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      {/* Left panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-card via-card/80 to-background border-r border-border flex-col justify-center px-16">
        <img src={logo} alt="DeepAuditAI" className="h-16 w-auto rounded-xl mb-6 self-start" />
        <h1 className="text-3xl font-bold text-foreground leading-tight mb-3" style={{ lineHeight: '1.15' }}>
          {t("auth.title")}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed mb-8 max-w-lg">
          {t("auth.subtitle")}
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-md">
          {[
            { icon: "🔍", title: t("auth.feature1"), desc: t("auth.feature1_desc") },
            { icon: "📋", title: t("auth.feature2"), desc: t("auth.feature2_desc") },
            { icon: "🔗", title: t("auth.feature3"), desc: t("auth.feature3_desc") },
            { icon: "📊", title: t("auth.feature4"), desc: t("auth.feature4_desc") },
          ].map((f) => (
            <div key={f.title} className="flex gap-2.5 p-3 rounded-lg bg-secondary/30 border border-border">
              <span className="text-xl">{f.icon}</span>
              <div>
                <div className="text-xs font-semibold text-foreground">{f.title}</div>
                <div className="text-[11px] text-muted-foreground">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel - Auth form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-6 lg:hidden">
            <img src={logo} alt="DeepAuditAI" className="h-14 w-auto rounded-xl mb-3" />
            <h1 className="text-xl font-bold text-foreground">DeepAuditAI</h1>
            <p className="text-muted-foreground text-xs">{t("platform.subtitle")}</p>
          </div>

          <Card className="bg-card/80 backdrop-blur-sm border-border">
            <CardHeader>
              <CardTitle>{mode === "login" ? t("auth.login") : t("auth.signup")}</CardTitle>
              <CardDescription>
                {mode === "login"
                  ? (language === "fr" ? "Accédez à votre tableau de bord de conformité" : "Access your compliance dashboard")
                  : (language === "fr" ? "Rejoignez votre équipe de conformité" : "Join your compliance team")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="fullName">{t("auth.fullname")}</Label>
                    <Input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ousmane Diallo"
                      required
                      className="bg-secondary/50"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">{t("auth.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nom@institution.com"
                    required
                    className="bg-secondary/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="bg-secondary/50"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t("common.loading") : mode === "login" ? t("auth.login_btn") : t("auth.signup_btn")}
                </Button>
              </form>

              <div className="mt-4 text-center text-sm text-muted-foreground">
                {mode === "login" ? (
                  <>
                    {t("auth.no_account")}{" "}
                    <button
                      onClick={() => setMode("signup")}
                      className="text-accent hover:underline font-medium"
                    >
                      {t("auth.create_one")}
                    </button>
                  </>
                ) : (
                  <>
                    {t("auth.has_account")}{" "}
                    <button
                      onClick={() => setMode("login")}
                      className="text-accent hover:underline font-medium"
                    >
                      {t("auth.login_here")}
                    </button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <p className="text-[10px] text-muted-foreground/50 text-center mt-4">
            © {new Date().getFullYear()} DeepAuditAI · {t("platform.tagline")}
          </p>
        </div>
      </div>
    </div>
  );
}
