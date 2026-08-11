import { handleAdminBookingAgreementDocumentGet } from "./implementation";

type AgreementDocumentRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: AgreementDocumentRouteContext) {
  return handleAdminBookingAgreementDocumentGet(request, context);
}
