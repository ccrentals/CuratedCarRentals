import {
  handleAdminBookingCancelPost,
  type AdminBookingCancelRouteContext,
} from "./implementation";

export async function POST(request: Request, context: AdminBookingCancelRouteContext) {
  return handleAdminBookingCancelPost(request, context);
}
