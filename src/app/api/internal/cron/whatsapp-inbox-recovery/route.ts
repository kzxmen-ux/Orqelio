import { recoverWhatsappInbox } from "@/features/messaging/whatsapp/inbox-recovery";
import { getCronSecret } from "@/lib/env/server";
import { createWhatsappInboxRecoveryGetHandler } from "./route-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createWhatsappInboxRecoveryGetHandler({
  getCronSecret,
  recoverInbox: recoverWhatsappInbox,
});
