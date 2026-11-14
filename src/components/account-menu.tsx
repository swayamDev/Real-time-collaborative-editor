"use client";

import { initials } from "@brahma/protocol";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useShell } from "./app-shell";
import { Menu } from "./menu";

/** The signed-in user's avatar, opening a menu with Sign out. */
export function AccountMenu() {
  const { user } = useShell();
  const router = useRouter();
  return (
    <Menu
      items={[
        {
          label: "Sign out",
          onSelect: async () => {
            await authClient.signOut();
            router.replace("/sign-in");
            router.refresh();
          },
        },
      ]}
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
