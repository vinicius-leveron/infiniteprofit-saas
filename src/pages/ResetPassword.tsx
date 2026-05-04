import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase coloca o token no hash da URL: #access_token=...&type=recovery
    const hash = window.location.hash;
    const isRecovery = hash.includes("type=recovery") || hash.includes("access_token");

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    // Fallback: se já existe sessão (recovery processado)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && isRecovery) setReady(true);
      else if (!isRecovery) {
        toast.error("Link inválido ou expirado. Solicite um novo.");
        setTimeout(() => navigate("/auth", { replace: true }), 2000);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha alterada com sucesso!");
      await supabase.auth.signOut();
      navigate("/auth", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao alterar senha";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <BarChart3 className="w-6 h-6 text-primary-foreground" strokeWidth={2.4} />
          </div>
          <h1 className="text-2xl font-extrabold gradient-text-brand">Infinite Profit</h1>
        </div>

        <div className="section-card">
          <h2 className="text-lg font-semibold mb-1">Definir nova senha</h2>
          <p className="text-sm text-muted-foreground mb-5">
            {ready
              ? "Escolha uma nova senha para sua conta."
              : "Validando link de recuperação..."}
          </p>

          {ready && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="password">Nova senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="confirm">Confirmar nova senha</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="mt-1.5"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Salvar nova senha
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
