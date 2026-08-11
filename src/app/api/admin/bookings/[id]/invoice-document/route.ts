import { handleAdminBookingInvoiceDocumentGet } from "./implementation";

type InvoiceDocumentRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: InvoiceDocumentRouteContext) {
  return handleAdminBookingInvoiceDocumentGet(request, context);
}
