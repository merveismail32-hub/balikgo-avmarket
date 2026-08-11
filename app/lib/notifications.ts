import "server-only";
import type { Prisma } from "@prisma/client";

export type NotificationDraft = { userId?: string; sellerId?: string; orderId?: string; type: string; dedupeKey: string; title: string; message: string; metadata?: Prisma.InputJsonValue };

export async function enqueueNotifications(tx: Prisma.TransactionClient, drafts: NotificationDraft[]) {
  if (!drafts.length) return;
  await tx.notification.createMany({ data: drafts.map((draft) => ({ ...draft, channel: "IN_APP", status: "PENDING" })), skipDuplicates: true });
}
