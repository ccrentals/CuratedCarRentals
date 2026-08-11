import {
  handleAdminBookingInspectionsGet,
  handleAdminBookingInspectionsPut,
} from "./implementation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAdminBookingInspectionsGet(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAdminBookingInspectionsPut(request, context);
}
