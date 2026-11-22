"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon, buttonClass, cn, type ButtonVariant } from "./index";

/** Lets forms rendered inside a modal close it after a successful submit. */
const ModalCloseContext = createContext<(() => void) | null>(null);
export function useModalClose() { return useContext(ModalCloseContext); }

export type ActionResult = { ok: boolean; message: string; data?: unknown } | null;
export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

export function SubmitButton({ children, variant = "primary", size = "md", icon, className, pendingText }: { children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; icon?: string; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(buttonClass(variant, size), className)}>
      {pending ? <Icon name="progress_activity" className="animate-spin text-[18px]" /> : icon && <Icon name={icon} className="text-[18px]" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/**
 * Form bound to a server action returning {ok, message}. Shows the result,
 * optionally resets, and refreshes server data on success.
 */
export function ActionForm({ action, children, className, resetOnSuccess = false, onSuccess, showMessage = true }: {
  action: FormAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; onSuccess?: (r: ActionResult) => void; showMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const closeModal = useModalClose();
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
      closeModal?.();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {showMessage && state?.message && <FormMessage ok={state.ok} message={state.message} />}
    </form>
  );
}

export function FormMessage({ ok, message }: { ok: boolean; message: string }) {
  return (
    <p role={ok ? "status" : "alert"} className={cn("mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-body-sm",
      ok ? "bg-accent-emerald/10 text-on-tertiary-fixed-variant" : "bg-error-container text-on-error-container")}>
      <Icon name={ok ? "check_circle" : "error"} className="text-[16px]" />{message}
    </p>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn("m-auto w-[calc(100%-2rem)] rounded-xl border border-border-subtle bg-surface p-0 shadow-float backdrop:bg-ink/40", wide ? "max-w-2xl" : "max-w-lg")}>
      {open && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
            <h2 className="font-heading text-heading-md text-ink">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-text hover:bg-surface-alt" aria-label="Close"><Icon name="close" /></button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Button that opens a modal containing arbitrary content (often an ActionForm). */
export function ModalButton({ label, title, icon, variant = "primary", size = "md", children, wide, className }: {
  label: ReactNode; title: ReactNode; icon?: string; variant?: ButtonVariant; size?: "sm" | "md"; wide?: boolean; className?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={cn(buttonClass(variant, size), className)} onClick={() => setOpen(true)}>
        {icon && <Icon name={icon} className="text-[18px]" />}{label}
      </button>
      <ModalCloseContext.Provider value={close}>
        <Modal open={open} onClose={close} title={title} wide={wide}>{typeof children === "function" ? children(close) : children}</Modal>
      </ModalCloseContext.Provider>
    </>
  );
}

/** One-click server action with confirmation (e.g. delete, approve). */
export function ConfirmAction({ action, label, confirm, icon, variant = "outline", size = "sm", fields, className }: {
  action: FormAction; label: ReactNode; confirm?: string; icon?: string; variant?: ButtonVariant; size?: "sm" | "md";
  fields: Record<string, string>; className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <form action={formAction} className={cn("inline", className)} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} size={size} icon={icon}>{label}</SubmitButton>
      {state && !state.ok && <span role="alert" className="ml-2 text-body-sm text-accent-red">{state.message}</span>}
    </form>
  );
}
