"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { MemberRole } from "@/db/schema";
import {
  changeRoleAction,
  getSharingAction,
  inviteAction,
  removeMemberAction,
  revokeInviteAction,
  setShareLinkAction,
} from "@/app/share-actions";
import type { SharingState } from "@/server/sharing";
import { AccountAvatar } from "./account-menu";
import { IconButton, iconProps } from "./icon-button";

const ROLE_LABELS: Record<MemberRole, string> = { editor: "Can edit", viewer: "Can view" };

function RoleSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as MemberRole)}
      className="focus-inset h-8 rounded-sm border border-hairline-strong bg-raised px-2 text-ui-sm text-ink outline-none focus:border-indigo"
    >
      <option value="editor">{ROLE_LABELS.editor}</option>
      <option value="viewer">{ROLE_LABELS.viewer}</option>
    </select>
  );
}

/** Name over email; just the email when there is no name (magic-link accounts). */
function PersonName({ name, email }: { name: string; email: string }) {
  return (
    <>
      <span className="block truncate text-ui-sm text-ink">{name || email}</span>
      {name && <span className="block truncate text-meta text-ink-muted">{email}</span>}
    </>
  );
}

export function ShareButton({ documentId, title }: { documentId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="share-button"
        className="mr-1 h-8 rounded-sm px-3 text-ui-sm font-medium text-ink transition-colors duration-100 hover:bg-hover"
      >
        Share
      </button>
      {open && <ShareDialog documentId={documentId} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ documentId, title, onClose }: { documentId: string; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [state, setState] = useState<SharingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("editor");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    ref.current?.showModal();
    void getSharingAction(documentId).then((result) => {
      if (result.ok) setState(result.value);
      else setError(result.error);
    });
  }, [documentId]);

  const run = useCallback(
    (action: () => Promise<{ ok: true; value: SharingState } | { ok: false; error: string }>, done?: () => void) => {
      setError(null);
      setNotice(null);
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setState(result.value);
        done?.();
      });
    },
    [],
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      data-testid="share-dialog"
      className="dialog-fade m-auto w-[min(32rem,calc(100vw-32px))] rounded-lg border border-hairline bg-raised p-0 text-ink shadow-float"
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline py-3 pr-2 pl-5">
        <h2 id={headingId} className="min-w-0 truncate text-[16px] leading-6 font-semibold">
          Share &ldquo;{title}&rdquo;
        </h2>
        <IconButton label="Close" onClick={() => ref.current?.close()}>
          <X {...iconProps} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-5 p-5">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => inviteAction(documentId, email, inviteRole),
              () => setEmail(""),
            );
          }}
        >
          <label htmlFor="share-email" className="sr-only">
            Email address
          </label>
          <input
            id="share-email"
            type="email"
            required
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="focus-inset h-8 min-w-0 flex-1 rounded-sm border border-hairline-strong bg-paper px-2 text-ui-sm text-ink outline-none placeholder:text-ink-muted focus:border-indigo"
          />
          <RoleSelect label="Role for the invite" value={inviteRole} onChange={setInviteRole} />
          <button
            type="submit"
            disabled={pending}
            className="h-8 rounded-sm bg-indigo px-3 text-ui-sm font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover disabled:opacity-70"
          >
            Invite
          </button>
        </form>

        {error && (
          <p role="alert" className="-mt-2 text-ui-sm text-madder">
            {error}
          </p>
        )}

        {state && (
          <ul aria-label="People with access" className="flex flex-col gap-2" data-testid="share-people">
            <li className="flex items-center gap-3">
              <AccountAvatar name={state.owner.name || state.owner.email} image={state.owner.image} size={28} />
              <span className="min-w-0 flex-1">
                <PersonName name={state.owner.name} email={state.owner.email} />
              </span>
              <span className="text-ui-sm text-ink-muted">Owner</span>
            </li>
            {state.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3" data-testid="share-member" data-email={member.email}>
                <AccountAvatar name={member.name || member.email} image={member.image} size={28} />
                <span className="min-w-0 flex-1">
                  <PersonName name={member.name} email={member.email} />
                </span>
                <RoleSelect
                  label={`Role for ${member.email}`}
                  value={member.role}
                  disabled={pending}
                  onChange={(role) => run(() => changeRoleAction(documentId, member.userId, role))}
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeMemberAction(documentId, member.userId))}
                  className="h-8 rounded-sm px-2 text-ui-sm text-madder transition-colors duration-100 hover:bg-madder-tint"
                >
                  Remove
                </button>
              </li>
            ))}
            {state.invites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3" data-testid="share-invite" data-email={invite.email}>
                <AccountAvatar name={invite.email} image={null} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-sm text-ink">{invite.email}</span>
                  <span className="block truncate text-meta text-ink-muted">Invited, {ROLE_LABELS[invite.role].toLowerCase()}</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => revokeInviteAction(documentId, invite.id))}
                  className="h-8 rounded-sm px-2 text-ui-sm text-madder transition-colors duration-100 hover:bg-madder-tint"
                >
                  Revoke invite
                </button>
              </li>
            ))}
          </ul>
        )}

        {state && (
          <section aria-label="Share link" className="border-t border-hairline pt-4" data-testid="share-link">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={state.link.enabled}
                  disabled={pending}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    run(
                      () => setShareLinkAction(documentId, enabled, state.link.role),
                      () => setNotice(enabled ? null : "Link turned off. Old links no longer work."),
                    );
                  }}
                  className="mt-1 size-4 accent-indigo"
                />
                <span>
                  <span className="block text-ui-sm text-ink">Anyone with the link</span>
                  <span className="block text-meta text-ink-muted">They&apos;ll need to sign in to open it.</span>
                </span>
              </label>
              <RoleSelect
                label="Role for people with the link"
                value={state.link.role}
                disabled={pending || !state.link.enabled}
                onChange={(role) => run(() => setShareLinkAction(documentId, true, role))}
              />
              {state.link.enabled && state.link.url && (
                <button
                  type="button"
                  data-testid="copy-link"
                  data-url={state.link.url}
                  onClick={() => {
                    void navigator.clipboard?.writeText(state.link.url!).then(() => setNotice("Copied"));
                  }}
                  className="h-8 rounded-sm border border-hairline-strong px-3 text-ui-sm font-medium text-ink transition-colors duration-100 hover:bg-hover"
                >
                  Copy link
                </button>
              )}
            </div>
            {notice && (
              <p role="status" className="mt-2 text-ui-sm text-ink-muted">
                {notice}
              </p>
            )}
          </section>
        )}
      </div>
    </dialog>
  );
}
