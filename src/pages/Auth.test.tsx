import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Auth from "./Auth";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signUp: mocks.signUp,
      resend: mocks.resend,
      signInWithPassword: mocks.signInWithPassword,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      signInWithOAuth: mocks.signInWithOAuth,
    },
  },
}));

function renderAuth(entry = "/auth?next=/clients") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Auth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.getSession.mockReset();
    mocks.signUp.mockReset();
    mocks.resend.mockReset();
    mocks.signInWithPassword.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.signInWithOAuth.mockReset();
    mocks.getSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps email confirmation as a persistent screen", async () => {
    vi.stubEnv("VITE_ENABLE_PUBLIC_SIGNUP", "true");
    mocks.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const firstRender = renderAuth();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("heading", { name: "Confirme seu email" })).toBeInTheDocument();
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "password-123",
      options: {
        emailRedirectTo:
          `${window.location.origin}/auth?next=${encodeURIComponent("/clients")}`,
      },
    });

    firstRender.unmount();
    renderAuth();

    expect(await screen.findByRole("heading", { name: "Confirme seu email" })).toBeInTheDocument();
    expect(screen.getByText(/owner@example.com/)).toBeInTheDocument();
  });

  it("keeps public account creation disabled when the flag is absent", async () => {
    vi.stubEnv("VITE_ENABLE_PUBLIC_SIGNUP", "");
    renderAuth();

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Criar conta" })).not.toBeInTheDocument();
    expect(screen.getByText("Novas contas são liberadas por convite.")).toBeInTheDocument();
  });

  it("hides public account creation when the feature flag is disabled", async () => {
    vi.stubEnv("VITE_ENABLE_PUBLIC_SIGNUP", "false");
    renderAuth();

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Criar conta" })).not.toBeInTheDocument();
    expect(screen.getByText("Novas contas são liberadas por convite.")).toBeInTheDocument();
  });

  it("allows invited users to create an account even when public signup is disabled", async () => {
    vi.stubEnv("VITE_ENABLE_PUBLIC_SIGNUP", "false");
    renderAuth(
      "/auth?next=%2Faccept-invite%3Fkind%3Dworkspace%26token%3Dinvite-token",
    );

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeInTheDocument();
  });
});
