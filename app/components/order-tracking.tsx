import type { OrderStatus } from "@prisma/client";

const steps: { status: Exclude<OrderStatus, "CANCELLED">; label: string }[] = [
  { status: "NEW", label: "Sipariş Alındı" },
  { status: "PREPARING", label: "Hazırlanıyor" },
  { status: "SHIPPED", label: "Kargolandı" },
  { status: "COMPLETED", label: "Teslim Edildi" },
];

export function OrderTracking({ statuses }: { statuses: OrderStatus[] }) {
  if (statuses.includes("CANCELLED")) return <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">Sipariş İptal Edildi</div>;
  const current = Math.max(...statuses.map((status) => Math.max(0, steps.findIndex((step) => step.status === status))));
  return <section className="mt-6 rounded-2xl border bg-slate-50 p-5"><p className="text-sm font-black text-slate-900">Sipariş takibi</p><div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0">{steps.map((step, index) => { const completed = index < current; const active = index === current; return <div key={step.status} className="flex flex-1 items-center sm:flex-col sm:items-start"><div className="flex w-full items-center sm:flex-col sm:items-start"><div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${completed ? "bg-sky-500 text-white" : active ? "bg-sky-600 text-white ring-4 ring-sky-100" : "bg-slate-200 text-slate-500"}`}>{completed ? "✓" : active ? "●" : "○"}</div><div className="ml-3 sm:ml-0 sm:mt-3"><p className={`text-sm font-bold ${completed || active ? "text-sky-700" : "text-slate-400"}`}>{step.label}</p><p className="text-xs text-slate-400">{active ? "Mevcut aşama" : completed ? "Tamamlandı" : "Bekliyor"}</p></div></div>{index < steps.length - 1 && <div className={`ml-4 h-8 w-px sm:ml-0 sm:mt-4 sm:h-px sm:w-full ${index < current ? "bg-sky-500" : "bg-slate-200"}`} />}</div>; })}</div></section>;
}
