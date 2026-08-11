import { handleAdminVehicleDocumentDownload } from "@/app/api/admin/vehicles/[id]/documents/[docId]/download/implementation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  // Guard delegated to `handleAdminVehicleDocumentDownload`, which enforces shared admin RBAC.
  return handleAdminVehicleDocumentDownload(request, context);
}
