"use client";
import { useState } from "react";

export function AdminRefundActions({ refundId, status }: { refundId: string; status: string }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  if (status !== "REQUESTED") return null;
  async function decide(decision: "APPROVE" | "REJECT") { setBusy(true); setMessage(""); try { const response = await fetch(`/api/admin/refunds/${refundId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }); const body = await response.json().catch(() => ({})) as { error?: string }; setMessage(response.ok ? "Karar kaydedildi; finansal iade yapılmadı." : body.error ?? "İşlem başarısız."); } finally { setBusy(false); } }
  return <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void decide("APPROVE")} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50">Onayla</button><button type="button" disabled={busy} onClick={() => void decide("REJECT")} className="rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-50">Reddet</button>{message && <span role="status" className="w-full text-xs text-slate-500">{message}</span>}</div>;
}
