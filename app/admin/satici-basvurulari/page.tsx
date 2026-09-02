import { AdminShell } from "../../components/admin-shell";
import { AdminApplicationsTable } from "../../components/admin-applications-table";
import { requireAdmin } from "@/app/lib/admin-auth";
import { prisma } from "@/app/lib/prisma";
import { adminSellerApplicationSummarySelect, toAdminSellerApplicationSummaryDto } from "@/app/lib/admin-seller-application-dto";
export default async function AdminApplicationsPage() { await requireAdmin(); const applications = await prisma.sellerProfile.findMany({ select: adminSellerApplicationSummarySelect, orderBy: { createdAt: "desc" } }); return <AdminShell title="Satıcı Başvuruları"><AdminApplicationsTable initialApplications={applications.map(toAdminSellerApplicationSummaryDto)} /></AdminShell>; }
