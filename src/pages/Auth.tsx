import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sanitizeNextPath } from "@/lib/authRedirect";

type AuthMode = "login" | "signup" | "forgot" | "check-email" | "recovery-sent";

interface PendingConfirmation {
  email: string;
  nextPath: string;
}

const CONFIRMATION_STORAGE_KEY = "infiniteprofit.pendingEmailConfirmation";

function readPendingConfirmation(): PendingConfirmation | null {
  try {
    const stored = sessionStorage.getItem(CONFIRMATION_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingConfirmation>;
    if (typeof parsed.email !== "string" || typeof parsed.nextPath !== "string") return null;
    return {
      email: parsed.email,
      nextPath: sanitizeNextPath(parsed.nextPath, "/"),
    };
  } catch {
    sessionStorage.removeItem(CONFIRMATION_STORAGE_KEY);
    return null;
  }
}

function authErrorMessage(error: unknown) {
  const fallback = "Não foi possível concluir a autenticação. Tente novamente.";
  if (!(error instanceof Error)) return fallback;

  const message = error.message.toLowerCase();
  if (message.includes("invalid login credentials")) return "Email ou senha incorretos.";
  if (message.includes("email not confirmed")) return "Confirme seu email antes de entrar.";
  if (message.includes("user already registered")) return "Já existe uma conta com este email.";
  if (message.includes("password should be")) return "Use uma senha com pelo menos 8 caracteres.";
  if (message.includes("rate limit") || message.includes("security purposes")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (
    message.includes("retryable") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return "A autenticação está temporariamente indisponível. Aguarde alguns instantes e tente novamente.";
  }
  return error.message || fallback;
}

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingConfirmation = readPendingConfirmation();
  const [mode, setMode] = useState<AuthMode>(
    pendingConfirmation ? "check-email" : "login",
  );
  const [email, setEmail] = useState(pendingConfirmation?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const nextPath = sanitizeNextPath(
    searchParams.get("next") ?? pendingConfirmation?.nextPath,
    "/",
  );
  const redirectUrl = `${window.location.origin}${nextPath}`;
  const emailConfirmationUrl =
    `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`;
  const googleAuthEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";
  const publicSignupEnabled = import.meta.env.VITE_ENABLE_PUBLIC_SIGNUP !== "false";
  const signupEnabled = publicSignupEnabled || nextPath.startsWith("/accept-invite?");

  useEffect(() => {
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) throw error;
        if (!active || !session) return;
        sessionStorage.removeItem(CONFIRMATION_STORAGE_KEY);
        navigate(nextPath, { replace: true });
      })
      .catch((error: unknown) => {
        if (active) setFeedback(authErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [navigate, nextPath]);

  const changeMode = (nextMode: AuthMode) => {
    setFeedback(null);
    setPassword("");
    setMode(nextMode);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setBusy(true);

    try {
      if (mode === "signup") {
        if (!signupEnabled) {
          throw new Error("A criação de contas está disponível somente por convite.");
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: emailConfirmationUrl },
        });
        if (error) throw error;
        if (data.session) {
          sessionStorage.removeItem(CONFIRMATION_STORAGE_KEY);
          navigate(nextPath, { replace: true });
          return;
        }

        const confirmation = { email: email.trim(), nextPath };
        sessionStorage.setItem(CONFIRMATION_STORAGE_KEY, JSON.stringify(confirmation));
        setMode("check-email");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMode("recovery-sent");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        sessionStorage.removeItem(CONFIRMATION_STORAGE_KEY);
        navigate(nextPath, { replace: true });
      }
    } catch (error) {
      setFeedback(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (mode === "check-email") {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email: email.trim(),
          options: { emailRedirectTo: emailConfirmationUrl },
        });
        if (error) throw error;
        setFeedback("Novo email de confirmação enviado.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setFeedback("Novo link de recuperação enviado.");
      }
    } catch (error) {
      setFeedback(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl },
      });
      if (error) throw error;
      if (!data.url) navigate(nextPath, { replace: true });
    } catch (error) {
      setFeedback(authErrorMessage(error));
      setBusy(false);
    }
  };

  const changeConfirmationEmail = () => {
    sessionStorage.removeItem(CONFIRMATION_STORAGE_KEY);
    changeMode(mode === "check-email" && signupEnabled ? "signup" : "forgot");
  };

  const isEmailState = mode === "check-email" || mode === "recovery-sent";
  const title =
    mode === "login"
      ? "Entrar"
      : mode === "signup"
        ? "Criar conta"
        : mode === "forgot"
          ? "Recuperar senha"
          : mode === "check-email"
            ? "Confirme seu email"
            : "Confira sua caixa de entrada";

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <BarChart3 className="w-6 h-6 text-primary-foreground" strokeWidth={2.4} />
          </div>
          <p className="text-2xl font-extrabold gradient-text-brand">Infinite Profit</p>
        </div>

        <section className="section-card" aria-labelledby="auth-title">
          {isEmailState && (
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <MailCheck className="w-6 h-6 text-primary" aria-hidden="true" />
            </div>
          )}

          <h1 id="auth-title" className="text-xl font-semibold mb-1">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mb-5">
            {mode === "login"
              ? "Acesse sua organização, clientes e funis."
              : mode === "signup"
                ? "Crie sua conta para configurar seu primeiro cliente."
                : mode === "forgot"
                  ? "Informe seu email para receber um link de redefinição."
                  : mode === "check-email"
                    ? `Enviamos um link de confirmação para ${email}.`
                    : `Enviamos um link de recuperação para ${email}.`}
          </p>

          {feedback && (
            <Alert
              variant={
                feedback.includes("enviado") || feedback.includes("enviada")
                  ? "default"
                  : "destructive"
              }
              className="mb-4"
            >
              <CircleAlert className="w-4 h-4" aria-hidden="true" />
              <AlertDescription>{feedback}</AlertDescription>
            </Alert>
          )}

          {isEmailState ? (
            <div className="space-y-3">
              <Button className="w-full min-h-11" onClick={handleResend} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                Reenviar email
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full min-h-11"
                onClick={changeConfirmationEmail}
                disabled={busy}
              >
                Usar outro email
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full min-h-11"
                onClick={() => changeMode("login")}
                disabled={busy}
              >
                <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                Voltar para o login
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                    className="mt-1.5 min-h-11"
                  />
                </div>
                {mode !== "forgot" && (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Senha</Label>
                      {mode === "login" && (
                        <button
                          type="button"
                          onClick={() => changeMode("forgot")}
                          className="text-xs text-primary hover:underline min-h-11 px-1"
                        >
                          Esqueci minha senha
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        minLength={mode === "signup" ? 8 : 6}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        className="mt-1.5 min-h-11 pr-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute right-0 top-1.5 w-11 h-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {mode === "signup" && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Use pelo menos 8 caracteres.
                      </p>
                    )}
                  </div>
                )}
                <Button type="submit" className="w-full min-h-11" disabled={busy}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                  {mode === "login"
                    ? "Entrar"
                    : mode === "signup"
                      ? "Criar conta"
                      : "Enviar link de recuperação"}
                </Button>
              </form>

              {mode !== "forgot" && googleAuthEnabled && (
                <>
                  <div className="relative my-5">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">ou</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-11"
                    onClick={handleGoogle}
                    disabled={busy}
                  >
                    Continuar com Google
                  </Button>
                </>
              )}

              <div className="mt-4 text-center text-sm text-muted-foreground">
                {mode === "forgot" ? (
                  <button
                    type="button"
                    onClick={() => changeMode("login")}
                    className="text-primary font-medium hover:underline min-h-11 px-2"
                  >
                    Voltar para o login
                  </button>
                ) : mode === "login" && signupEnabled ? (
                  <>
                    Não tem conta?{" "}
                    <button
                      type="button"
                      onClick={() => changeMode("signup")}
                      className="text-primary font-medium hover:underline min-h-11 px-1"
                    >
                      Criar conta
                    </button>
                  </>
                ) : mode === "signup" ? (
                  <>
                    Já tem conta?{" "}
                    <button
                      type="button"
                      onClick={() => changeMode("login")}
                      className="text-primary font-medium hover:underline min-h-11 px-1"
                    >
                      Entrar
                    </button>
                  </>
                ) : (
                  <p>Novas contas são liberadas por convite.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
