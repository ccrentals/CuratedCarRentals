import {
  handleAdminBookingInspectionImageDelete,
  handleAdminBookingInspectionImageGet,
  type ImageItemRouteContext,
} from "./implementation";

export async function DELETE(request: Request, context: ImageItemRouteContext) {
  return handleAdminBookingInspectionImageDelete(request, context);
}

export async function GET(request: Request, context: ImageItemRouteContext) {
  return handleAdminBookingInspectionImageGet(request, context);
}
