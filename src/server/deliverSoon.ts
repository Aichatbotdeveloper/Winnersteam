import "server-only";
import { after } from "next/server";
import { dispatchNotifications } from "@/server/delivery";

/**
 * Deliver pending e-mail/push notifications right after the current response is
 * sent, so users do not wait for the next scheduled run. Safe to call often:
 * each notification is claimed atomically before sending.
 */
export function deliverSoon() {
  after(async () => {
    try {
      await dispatchNotifications(50);
    } catch (e) {
      console.error("immediate notification delivery failed", e);
    }
  });
}
