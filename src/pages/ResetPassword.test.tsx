import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPassword from "./ResetPassword";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  },
}));

function renderResetPassword() {
  return render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResetPassword", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/reset-password");
    mocks.getSession.mockReset();
    mocks.onAuthStateChange.mockReset();
    mocks.updateUser.mockReset();
    mocks.signOut.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mocks.unsubscribe } },
    });
  });

  it("keeps an invalid recovery link visible with a recovery action", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    renderResetPassword();

    expect(await screen.findByText("O link de recuperação é inválido ou expirou.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar novo link" })).toBeInTheDocument();
  });

  it("validates matching passwords before updating the account", async () => {
    window.history.replaceState({}, "", "/reset-password?code=recovery-code");
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "recovery-token" } },
      error: null,
    });
    renderResetPassword();

    const password = await screen.findByLabelText("Nova senha");
    fireEvent.change(password, { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "different-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByText("As senhas não coincidem.")).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
