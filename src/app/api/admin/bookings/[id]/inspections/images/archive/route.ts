import {
  handleAdminBookingInspectionImagesArchivePost,
  type ArchiveRouteContext,
} from "./implementation";

export async function POST(request: Request, context: ArchiveRouteContext) {
  return handleAdminBookingInspectionImagesArchivePost(request, context);
}
