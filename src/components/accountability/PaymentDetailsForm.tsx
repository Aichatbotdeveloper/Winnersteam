"use client";

import { Card, CardHeader, Icon } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { savePaymentDetails } from "@/server/actions/fines";
import type { PayeeDetails } from "./FinePayment";

const BANKS = ["OPay", "Moniepoint", "PalmPay", "Kuda", "Access Bank", "First Bank", "GTBank", "UBA", "Zenith Bank", "Wema Bank", "Fidelity Bank", "Union Bank", "Sterling Bank", "FCMB", "Stanbic IBTC", "Polaris Bank", "Ecobank"];

/** Administrator: the account team members pay fines into. */
export function PaymentDetailsForm({ details }: { details: PayeeDetails | null }) {
  return (
    <Card id="payment-details" className="scroll-mt-24 p-5">
      <CardHeader icon="account_balance" eyebrow="Fines" title="Payment details for fines" />
      <p className="mt-2 text-body-md text-muted-text">Team members with a financial fine will see these details, pay you by transfer and upload their receipt. You then confirm on the Accountability page.</p>
      <ActionForm action={savePaymentDetails} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Account name</span><input name="account_name" required maxLength={120} defaultValue={details?.account_name} className="input" /></label>
        <label className="block"><span className="label">Account number</span><input name="account_number" required inputMode="numeric" pattern="[0-9 ]{10,13}" maxLength={13} defaultValue={details?.account_number} placeholder="10 digits" className="input" /></label>
        <label className="block"><span className="label">Bank</span><input name="bank_name" required maxLength={80} list="wt-banks" defaultValue={details?.bank_name} placeholder="e.g. OPay" className="input" /></label>
        <datalist id="wt-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-3">
          <span className="flex items-center gap-1.5 text-body-sm text-muted-text"><Icon name="lock" className="text-[16px]" />Only your assigned team members and the Super Admin can see these.</span>
          <SubmitButton icon="save">{details ? "Update details" : "Save details"}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
