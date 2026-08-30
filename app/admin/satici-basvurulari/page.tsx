import { AdminShell } from "../../components/admin-shell";
import { AdminApplicationsTable } from "../../components/admin-applications-table";
import { requireAdmin } from "@/app/lib/admin-auth";
import { prisma } from "@/app/lib/prisma";
export default async function AdminApplicationsPage() { await requireAdmin(); const applications = await prisma.sellerProfile.findMany({ include: { user: { select: { name: true, surname: true, email: true, phone: true } }, kybDocuments: { select: { type: true, status: true } } }, orderBy: { createdAt: "desc" } }); return <AdminShell title="Satıcı Başvuruları"><AdminApplicationsTable initialApplications={applications.map(application => ({ ...application, createdAt: application.createdAt.toISOString(), submittedAt: application.submittedAt?.toISOString() ?? null }))} /></AdminShell>; }
