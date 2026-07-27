import { RequireAuth } from "@/components/system/RequireAuth";
import { AdminSettings } from "@/components/admin/AdminSettings";

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminSettings />
    </RequireAuth>
  );
}
