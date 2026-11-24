"use client";

import { useState } from "react";
import { Badge, Icon } from "@/components/ui";
import { ActionForm, ConfirmAction, ModalButton, SubmitButton, toast } from "@/components/ui/client";
import { decideFinePayment, submitFinePayment } from "@/server/actions/fines";
import { naira } from "@/lib/format";
import { shrinkOnSelect } from "@/lib/shrinkImage";

export type PayeeDetails = { account_name: string; account_number: string; bank_name: string };
export type FinePaymentRow = { status: "submitted" | "confirmed" | "rejected"; reason: string | null; amount: number; payee_snapshot: PayeeDetails };

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="text-label-sm uppercase tracking-wider text-muted-text">{label}</div>
        <div className="truncate font-heading text-body-lg text-ink">{value}</div>
      </div>
      <button type="button" className="flex shrink-0 items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-1.5 text-body-sm font-semibold text-secondary hover:bg-surface-container-low"
        onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); toast(`${label} copied`); window.setTimeout(() => setDone(false), 1500); }); }}>
        <Icon name={done ? "check" : "content_copy"} className="text-[16px]" />{done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Member: shows the administrator's account and sends "I've paid" with a receipt. */
export function PayFineButton({ ledgerId, amount, payee, payment }: { ledgerId: string; amount: number; payee: PayeeDetails | null; payment: FinePaymentRow | null }) {
  if (payment?.status === "submitted") return <Badge tone="blue" dot>Payment sent · waiting for confirmation</Badge>;
  if (payment?.status === "confirmed") return <Badge tone="green" dot>Paid · confirmed</Badge>;
  if (!payee) return <span className="text-body-sm text-muted-text">Your administrator hasn&apos;t added payment details yet.</span>;
  return (
    <div className="space-y-1.5">
      {payment?.status === "rejected" && <div className="max-w-64 text-body-sm text-accent-red">Not received: {payment.reason}</div>}
      <ModalButton label={payment?.status === "rejected" ? "Pay again" : `Pay ${naira(amount)}`} title={`Pay your ${naira(amount)} fine`} icon="payments" variant="secondary" size="sm">
        <div className="space-y-4">
          <p className="text-body-md text-muted-text">Transfer <strong className="text-ink">{naira(amount)}</strong> to your administrator&apos;s account below from your own bank app, then upload the receipt.</p>
          <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-alt/50">
            <CopyRow label="Amount" value={String(Number(amount))} />
            <CopyRow label="Account number" value={payee.account_number} />
            <CopyRow label="Account name" value={payee.account_name} />
            <div className="px-4 py-3"><div className="text-label-sm uppercase tracking-wider text-muted-text">Bank</div><div className="font-heading text-body-lg text-ink">{payee.bank_name}</div></div>
          </div>
          <ActionForm action={submitFinePayment} className="space-y-3">
            <input type="hidden" name="ledger_id" value={ledgerId} />
            <label className="block"><span className="label">Payment receipt <span className="font-normal text-muted-text">(screenshot or photo, or a PDF up to 2 MB)</span></span>
              <input type="file" name="receipt" required accept="image/png,image/jpeg,image/webp,application/pdf" onChange={shrinkOnSelect(1600)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-on-secondary" /></label>
            <label className="block"><span className="label">Note <span className="font-normal text-muted-text">(optional)</span></span>
              <input name="note" maxLength={500} placeholder="e.g. Paid from my OPay at 4:10 PM" className="input" /></label>
            <p className="flex gap-1.5 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-muted-text"><Icon name="info" className="text-[16px]" />Nothing is taken from your account by Winners Team. You pay by transfer yourself, and your administrator confirms it.</p>
            <div className="flex justify-end"><SubmitButton icon="send" pendingText="Sending…">I&apos;ve paid</SubmitButton></div>
          </ActionForm>
        </div>
      </ModalButton>
    </div>
  );
}

/** Administrator (payee) / Super Admin: view the receipt and confirm. */
export function ConfirmPayment({ ledgerId, receiptUrl, payment }: { ledgerId: string; receiptUrl: string | null; payment: FinePaymentRow }) {
  if (payment.status === "confirmed") return <Badge tone="green" dot>Paid · confirmed</Badge>;
  if (payment.status === "rejected") return <Badge tone="red" dot>Not received · waiting for the member</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="blue" dot>Says paid {naira(payment.amount)}</Badge>
      {receiptUrl && <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-body-sm font-semibold text-secondary hover:underline"><Icon name="receipt_long" className="text-[16px]" />Receipt</a>}
      <ConfirmAction action={decideFinePayment} fields={{ ledger_id: ledgerId, decision: "received" }} label="Confirm received" icon="check_circle" variant="success"
        confirm={`Confirm you received ${naira(payment.amount)} in your ${payment.payee_snapshot.bank_name} account?`} />
      <ModalButton label="Not received" title="Payment not received" icon="block" variant="ghost" size="sm">
        <ActionForm action={decideFinePayment} className="space-y-3">
          <input type="hidden" name="ledger_id" value={ledgerId} /><input type="hidden" name="decision" value="not_received" />
          <label className="block"><span className="label">Tell the member why</span>
            <input name="reason" required minLength={3} maxLength={500} placeholder="e.g. I can't see this payment in my account yet" className="input" /></label>
          <div className="flex justify-end"><SubmitButton variant="danger" icon="send">Send</SubmitButton></div>
        </ActionForm>
      </ModalButton>
    </div>
  );
}
