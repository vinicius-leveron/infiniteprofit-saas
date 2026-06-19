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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
    });

    let active = true;
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!active) return;
      applySession(s);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user, loading }),
    [loading, session, user],
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
