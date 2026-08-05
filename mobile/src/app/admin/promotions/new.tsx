import { AdminGate } from "@/admin/AdminShell";
import { AdminPromoForm } from "@/admin/PromoForm";

export default function NewPromotionScreen() { return <AdminGate><AdminPromoForm mode="create" /></AdminGate>; }
