import {
  handleAdminBookingAddPaymentPost,
  type AddPaymentRouteContext,
} from "./implementation";

export async function POST(request: Request, context: AddPaymentRouteContext) {
  return handleAdminBookingAddPaymentPost(request, context);
}
