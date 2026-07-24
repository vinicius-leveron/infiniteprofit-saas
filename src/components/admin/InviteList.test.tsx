import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InviteList, type AdminInvite } from "./InviteList";
import { publicConfig } from "@/lib/publicConfig";

const pendingInvite: AdminInvite = {
  id: "invite-pending",
  email: "pessoa@empresa.com",
  role: "member",
  token: "safe-token",
  expires_at: "2099-07-24T12:00:00.000Z",
  accepted_at: null,
  revoked_at: null,
};

describe("InviteList", () => {
  it("shows invite status and exposes management actions only to admins", () => {
    const onCopy = vi.fn();
    const onRenew = vi.fn();
    const onRevoke = vi.fn();
    const { rerender } = render(
      <InviteList
        invites={[pendingInvite]}
        kind="workspace"
        canManage={false}
        onCopy={onCopy}
        onRenew={onRenew}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revogar" })).not.toBeInTheDocument();

    rerender(
      <InviteList
        invites={[pendingInvite]}
        kind="workspace"
        canManage
        onCopy={onCopy}
        onRenew={onRenew}
        onRevoke={onRevoke}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    fireEvent.click(screen.getByRole("button", { name: "Revogar" }));

    expect(onCopy).toHaveBeenCalledWith(
      `${publicConfig.appUrl}/accept-invite?kind=workspace&token=safe-token`,
    );
    expect(onRevoke).toHaveBeenCalledWith(pendingInvite);
  });

  it("hides Owner invite mutations from an Admin", () => {
    render(
      <InviteList
        invites={[{ ...pendingInvite, id: "owner-invite", role: "owner" }]}
        kind="workspace"
        canManage
        canManageOwner={false}
        onCopy={vi.fn()}
        onRenew={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Copiar link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reenviar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revogar" })).not.toBeInTheDocument();
  });
});
