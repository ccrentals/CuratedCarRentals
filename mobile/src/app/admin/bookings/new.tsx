import { AdminBookingCreateForm } from "@/admin/BookingCreateForm";
import { AdminGate } from "@/admin/AdminShell";

export default function NewBookingScreen() {
  return <AdminGate><AdminBookingCreateForm /></AdminGate>;
}
