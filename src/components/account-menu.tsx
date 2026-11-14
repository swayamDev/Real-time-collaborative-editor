"use client";

import { initials } from "@brahma/protocol";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { closeLocalStores, getLocalStore } from "@/lib/collab/device-store";
import { SIGN_OUT_FAILED, SIGN_OUT_UNSYNCED } from "@/lib/copy";
import { clearDevice } from "@/lib/device-data";
import { useShell } from "./app-shell";
import { ConfirmDialog } from "./confirm-dialog";
import { Menu } from "./menu";

type Dialog = null | "unsynced" | "failed";

/** The signed-in user's avatar, opening a menu with Sign out. */
export function AccountMenu() {
  const { user } = useShell();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, setPending] = useState(false);

  /**
   * End the session, then delete this user's data from the device:
   * documents, offline edits, cached pages. Other tabs follow. A full page
   * load afterwards leaves nothing of this user in memory.
   */
  const signOut = async () => {
    setPending(true);
    const result = await authClient.signOut().catch(() => ({ error: true }));
    if (!result || result.error) {
      setPending(false);
      setDialog("failed");
      return;
    }
    await closeLocalStores();
    await clearDevice(user.id).catch(() => {});
    window.location.replace("/sign-in");
  };

  const requestSignOut = async () => {
    const store = await getLocalStore(user.id);
    const documents = store ? await store.listDocuments().catch(() => []) : [];
    if (documents.some((meta) => meta.pendingCount > 0)) setDialog("unsynced");
    else void signOut();
  };

  return (
    <>
      <Menu
        items={[{ label: "Sign out", onSelect: () => void requestSignOut() }]}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={`Account: ${user.name || user.email}`}
            title={user.email}
            data-testid="account-menu"
            className="ml-1 inline-flex size-8 items-center justify-center rounded-full"
          >
            <AccountAvatar name={user.name || user.email} image={user.image} />
          </button>
        )}
      />
      <ConfirmDialog
        open={dialog !== null}
        title={dialog === "failed" ? "Couldn't sign out" : "Sign out?"}
        description={dialog === "failed" ? SIGN_OUT_FAILED : SIGN_OUT_UNSYNCED}
        confirmLabel={dialog === "failed" ? "Try again" : "Sign out"}
        pendingLabel="Signing out"
        pending={pending}
        onConfirm={() => void signOut()}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}

export function AccountAvatar({ name, image, size = 24 }: { name: string; image: string | null; size?: number }) {
  if (image) {
    // A remote avatar (Google); plain <img> keeps it out of the image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} className="rounded-full" referrerPolicy="no-referrer" />;
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-full bg-indigo-tint text-[10px] font-semibold text-indigo"
    >
      {initials(name)}
    </span>
  );
}
