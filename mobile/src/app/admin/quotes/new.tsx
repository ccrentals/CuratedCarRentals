import { AdminQuoteCreateForm } from "@/admin/QuoteCreateForm";
import { AdminGate } from "@/admin/AdminShell";

export default function NewQuoteScreen() {
  return <AdminGate><AdminQuoteCreateForm /></AdminGate>;
}
