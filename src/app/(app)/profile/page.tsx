import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProfileView } from "@/components/profile/ProfileView";
import { PaymentDetailsForm } from "@/components/accountability/PaymentDetailsForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Profile" };

export default async function ProfilePage() {
  const me = await requireUser();
  const supabase = await createClient();
  const [details, fines] = me.role === "administrator" ? await Promise.all([
    supabase.from("admin_payment_details").select("account_name,account_number,bank_name").eq("admin_id", me.id).maybeSingle(),
    supabase.from("system_settings").select("value").eq("key", "fines.payments_enabled").maybeSingle(),
  ]) : [null, null];
  return (
    <>
      <PageHeader eyebrow="Single profile architecture" title="My Unified Profile" description="Your basic information, professional information and every service you offer — all in one profile." />
      {fines?.data?.value === true && <div className="mb-5"><PaymentDetailsForm details={details?.data ?? null} /></div>}
      <ProfileView profile={me} editable />
    </>
  );
}
