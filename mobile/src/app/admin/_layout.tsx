import { Stack } from "expo-router";

import { AdminAuthProvider } from "@/admin/AdminAuthProvider";

export default function AdminLayout() {
  return (
    <AdminAuthProvider>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
    </AdminAuthProvider>
  );
}
