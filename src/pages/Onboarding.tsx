import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUpdateProfile } from "@/hooks/useSupabaseData";
import { useAuth } from "@/hooks/useAuth";
import logo from "@/assets/logo.png";
import { Shield, CheckCircle2, Users, FileText, Lock } from "lucide-react";

const STEPS = [
  { id: 1, label: "Bienvenue", icon: Shield },
  { id: 2, label: "Profil", icon: Users },
  { id: 3, label: "Conditions", icon: FileText },
];

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const updateProfile = useUpdateProfile();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleComplete = async () => {
    if (!acceptedTerms) {
      toast({ title: "Veuillez accepter les conditions d'utilisation", variant: "destructive" });
      return;
    }
    if (!fullName.trim()) {
      toast({ title: "Veuillez renseigner votre nom complet", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await updateProfile.mutateAsync({ full_name: fullName.trim(), organization: organization.trim() });
      toast({ title: "✅ Profil configuré !", description: "Bienvenue sur DeepAuditAI" });
      navigate("/", { replace: true });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="DeepAuditAI" className="h-16 w-auto rounded-xl shadow-lg mb-4" />
          <h1 className="text-2xl font-bold text-foreground">DeepAuditAI</h1>
          <p className="text-muted-foreground text-sm">Configuration de votre compte</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex items-center">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                step === s.id
                  ? "bg-primary text-primary-foreground shadow-md"
                  : step > s.id
                  ? "bg-primary/20 text-primary"
                  : "bg-secondary/50 text-muted-foreground"
              }`}>
                {step > s.id ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <s.icon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`w-8 h-px mx-1 ${step > s.id ? "bg-primary/40" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        <Card className="bg-card/80 backdrop-blur-sm border-border shadow-xl">
          <CardContent className="p-8">
            {/* Step 1 — Welcome */}
            {step === 1 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-center mx-auto">
                    <Shield className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-bold">Bienvenue sur DeepAuditAI</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Plateforme d'analyse AML/LBC conforme aux exigences <strong>BCEAO/CENTIF</strong> pour l'Afrique de l'Ouest.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: Shield, label: "Détection AML", desc: "Scoring IA temps réel" },
                    { icon: Users, label: "RBAC avancé", desc: "Contrôle d'accès granulaire" },
                    { icon: FileText, label: "Rapports STR", desc: "Conformité CENTIF" },
                    { icon: Lock, label: "Sécurité", desc: "Données chiffrées" },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="p-3 bg-secondary/30 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold">{label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg text-xs text-muted-foreground">
                  <span className="font-semibold text-accent">👤 Compte détecté :</span> {user?.email}
                </div>

                <Button className="w-full" onClick={() => setStep(2)}>
                  Commencer la configuration →
                </Button>
              </motion.div>
            )}

            {/* Step 2 — Profile */}
            {step === 2 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-bold">Votre profil</h2>
                  <p className="text-sm text-muted-foreground">Ces informations figureront dans vos rapports AML officiels</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Nom complet *</Label>
                    <Input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Prénom NOM"
                      required
                      className="bg-secondary/50"
                    />
                    <p className="text-xs text-muted-foreground">Apparaîtra sur les rapports STR et exports PDF</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="organization">Organisation / Institution</Label>
                    <Input
                      id="organization"
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="Banque de l'Habitat du Sénégal..."
                      className="bg-secondary/50"
                    />
                    <p className="text-xs text-muted-foreground">Nom de votre établissement financier ou organisme de conformité</p>
                  </div>

                  <div className="p-3 bg-secondary/30 rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Email</span>
                      <span className="font-mono">{user?.email}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Rôle initial</span>
                      <Badge variant="secondary" className="text-xs">auditor</Badge>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>← Retour</Button>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      if (!fullName.trim()) {
                        toast({ title: "Le nom complet est requis", variant: "destructive" });
                        return;
                      }
                      setStep(3);
                    }}
                  >
                    Continuer →
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3 — Terms */}
            {step === 3 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-bold">Conditions d'utilisation</h2>
                  <p className="text-sm text-muted-foreground">Conformité réglementaire BCEAO/CENTIF</p>
                </div>

                <div className="bg-secondary/30 rounded-lg p-4 max-h-52 overflow-y-auto text-xs text-muted-foreground space-y-3 leading-relaxed">
                  <div>
                    <p className="font-semibold text-foreground mb-1">1. Usage réglementaire</p>
                    <p>DeepAuditAI est une plateforme de conformité AML/LBC destinée exclusivement aux professionnels assujettis à la réglementation BCEAO et aux obligations de la CENTIF. L'utilisation est strictement limitée à des fins de conformité légale.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground mb-1">2. Confidentialité des données</p>
                    <p>Toutes les données financières traitées sur la plateforme sont strictement confidentielles. L'utilisateur s'engage à ne pas divulguer les informations d'investigation à des tiers non autorisés conformément au secret professionnel.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground mb-1">3. Obligations de déclaration</p>
                    <p>L'utilisateur reconnaît ses obligations légales de déclaration de soupçon auprès de la CENTIF conformément à la Loi uniforme LBC/FT BCEAO 2016 et au Règlement UEMOA N°14/2002/CM.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground mb-1">4. Traçabilité</p>
                    <p>Toutes les actions effectuées sur la plateforme sont enregistrées dans un journal d'audit immuable conformément aux exigences de conservation de 10 ans minimum.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground mb-1">5. Responsabilité</p>
                    <p>L'utilisateur est seul responsable des décisions prises sur la base des analyses fournies par la plateforme. DeepAuditAI est un outil d'aide à la décision et ne se substitue pas au jugement professionnel du compliance officer.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <Checkbox
                    id="terms"
                    checked={acceptedTerms}
                    onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="terms" className="text-sm leading-relaxed cursor-pointer">
                    J'accepte les conditions d'utilisation et confirme être un professionnel assujetti aux obligations LBC/FT conformément à la réglementation BCEAO/CENTIF.
                  </Label>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>← Retour</Button>
                  <Button
                    className="flex-1"
                    disabled={!acceptedTerms || loading}
                    onClick={handleComplete}
                  >
                    {loading ? "Configuration..." : "✅ Accéder à la plateforme"}
                  </Button>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
