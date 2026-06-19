import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "./useAuth";

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  listener: null as ((event: string, session: Session | null) => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: authMock.getSession,
      onAuthStateChange: vi.fn(
        (listener: (event: string, session: Session | null) => void) => {
          authMock.listener = listener;
          return {
            data: {
              subscription: {
                unsubscribe: authMock.unsubscribe,
              },
            },
          };
        },
      ),
    },
  },
}));

function createSession(accessToken: string, user: User): Session {
  return {
    access_token: accessToken,
    refresh_token: "refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
}

describe("AuthProvider", () => {
  beforeEach(() => {
    authMock.getSession.mockReset();
    authMock.listener = null;
    authMock.unsubscribe.mockReset();
  });

  it("keeps user identity stable when Supabase refreshes the same session", async () => {
    const user = {
      id: "user-1",
      email: "owner@example.com",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-06-19T00:00:00.000Z",
    } as User;
    const initialSession = createSession("access-token-1", user);
    const refreshedSession = createSession("access-token-2", { ...user });
    const userEffect = vi.fn();

    function Probe() {
      const { loading, user: authUser } = useAuth();

      useEffect(() => {
        if (!loading) userEffect(authUser);
      }, [authUser, loading]);

      return <div>{loading ? "loading" : authUser?.email ?? "no-user"}</div>;
    }

    authMock.getSession.mockResolvedValue({ data: { session: initialSession } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("owner@example.com")).toBeInTheDocument());
    expect(userEffect).toHaveBeenCalledTimes(1);

    await act(async () => {
      authMock.listener?.("TOKEN_REFRESHED", refreshedSession);
    });

    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(userEffect).toHaveBeenCalledTimes(1);
  });
});
