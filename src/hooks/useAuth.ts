import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const applySession = useCallback((nextSession: Session | null) => {
    const nextUser = nextSession?.user ?? null;
    setSession(nextSession);
    setUser((currentUser) => {
      if (!currentUser || !nextUser) return nextUser;
      if (currentUser.id === nextUser.id && currentUser.email === nextUser.email) {
        return currentUser;
      }
      return nextUser;
    });
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s);
      setError(null);
      setLoading(false);
    });

    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data: { session: s }, error: sessionError }) => {
        if (sessionError) throw sessionError;
        if (!active) return;
        applySession(s);
        setError(null);
      })
      .catch((sessionError: unknown) => {
        if (!active) return;
        setError(authBootstrapErrorMessage(sessionError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession, retryVersion]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setRetryVersion((current) => current + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user, loading, error, retry }),
    [error, loading, retry, session, user],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

function authBootstrapErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.trim() : "";
  if (
    /retryable|failed to fetch|fetch failed|timeout|timed out|502|503|504/i.test(detail)
  ) {
    return "A autenticação está temporariamente indisponível. Tente novamente em instantes.";
  }
  return detail || "Não foi possível validar sua sessão. Tente novamente.";
}
