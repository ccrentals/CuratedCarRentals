import { handleAdminVehicleDocumentDownload } from "@/app/api/admin/vehicles/[id]/documents/[docId]/download/route";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  return handleAdminVehicleDocumentDownload(request, context);
}
