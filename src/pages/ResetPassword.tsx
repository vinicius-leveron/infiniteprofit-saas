import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, CircleAlert, Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RecoveryStatus = "validating" | "ready" | "invalid" | "success";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<RecoveryStatus>("validating");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasRecoveryHint =
      params.has("code") ||
      hashParams.get("type") === "recovery" ||
      hashParams.has("access_token");
    const providerError =
      params.get("error_description") ?? hashParams.get("error_description");

    if (providerError) {
      setError(decodeURIComponent(providerError.replace(/\+/g, " ")));
      setStatus("invalid");
      return;
    }

    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && hasRecoveryHint)) {
        setError(null);
        setStatus("ready");
      }
    });

    void supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setStatus("invalid");
      } else if (session && hasRecoveryHint) {
        setStatus("ready");
      } else {
        setError("O link de recuperação é inválido ou expirou.");
        setStatus("invalid");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      window.history.replaceState({}, document.title, "/reset-password");
      setPassword("");
      setConfirm("");
      setStatus("success");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Não foi possível alterar sua senha. Solicite um novo link.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <BarChart3 className="w-6 h-6 text-primary-foreground" strokeWidth={2.4} />
          </div>
          <p className="text-2xl font-extrabold gradient-text-brand">Infinite Profit</p>
        </div>

        <section className="section-card" aria-labelledby="reset-title">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-5">
            <LockKeyhole className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <h1 id="reset-title" className="text-xl font-semibold mb-1">
            {status === "success" ? "Senha alterada" : "Definir nova senha"}
          </h1>
          <p className="text-sm text-muted-foreground mb-5">
            {status === "validating"
              ? "Validando seu link de recuperação…"
              : status === "ready"
                ? "Escolha uma senha segura para sua conta."
                : status === "success"
                  ? "Sua nova senha já está ativa. Entre novamente para continuar."
                  : "Não foi possível validar este link."}
          </p>

          {status === "validating" && (
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              Aguarde um instante…
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <CircleAlert className="w-4 h-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {status === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="password">Nova senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPasswords ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="mt-1.5 min-h-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((visible) => !visible)}
                    className="absolute right-0 top-1.5 w-11 h-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showPasswords ? "Ocultar senhas" : "Mostrar senhas"}
                  >
                    {showPasswords ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Use pelo menos 8 caracteres.
                </p>
              </div>
              <div>
                <Label htmlFor="confirm">Confirmar nova senha</Label>
                <Input
                  id="confirm"
                  type={showPasswords ? "text" : "password"}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="mt-1.5 min-h-11"
                />
              </div>
              <Button type="submit" className="w-full min-h-11" disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                Salvar nova senha
              </Button>
            </form>
          )}

          {(status === "invalid" || status === "success") && (
            <Button
              type="button"
              className="w-full min-h-11"
              onClick={() => navigate("/auth", { replace: true })}
            >
              {status === "success" ? "Entrar" : "Solicitar novo link"}
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}
