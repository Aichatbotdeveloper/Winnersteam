import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles every Supabase e-mail link: sign-up confirmation, password recovery,
 * administrator invitations and e-mail changes. Supports both the PKCE `code`
 * flow and `token_hash` links (recommended e-mail templates in supabase/templates).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const rawNext = url.searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const dest = type === "invite" ? "/set-password" : type === "recovery" ? "/reset-password" : next;
      return NextResponse.redirect(new URL(dest, url.origin));
    }
  } else {
    // Implicit-flow links put tokens in the URL fragment, which only the browser can read.
    return NextResponse.redirect(new URL(`/auth/finish?next=${encodeURIComponent(next)}`, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
