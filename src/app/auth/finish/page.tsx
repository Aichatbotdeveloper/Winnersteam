"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function FinishAuth() {
  const [msg, setMsg] = useState("Completing sign-in…");
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    const type = hash.get("type");
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    if (!access_token || !refresh_token) {
      setMsg(hash.get("error_description") ?? "This link is invalid or has expired.");
      return;
    }
    createClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) return setMsg(error.message);
      const dest = type === "invite" ? "/set-password" : type === "recovery" ? "/reset-password" : next.startsWith("/") ? next : "/";
      window.location.replace(dest);
    });
  }, []);
  return <main className="flex min-h-screen items-center justify-center p-6 text-body-md text-muted-text">{msg}</main>;
}
