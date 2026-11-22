import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = { title: "My Profile" };

export default async function ProfilePage() {
  const me = await requireUser();
  return (
    <>
      <PageHeader eyebrow="Single profile architecture" title="My Unified Profile" description="Your basic information, professional information and every service you offer — all in one profile." />
      <ProfileView profile={me} editable />
    </>
  );
}
