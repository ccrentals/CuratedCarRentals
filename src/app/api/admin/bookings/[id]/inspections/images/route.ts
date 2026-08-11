import {
  handleAdminBookingInspectionImagesPost,
  type ImageRouteContext,
} from "./implementation";

export async function POST(request: Request, context: ImageRouteContext) {
  return handleAdminBookingInspectionImagesPost(request, context);
}
