import { RequireAuth } from "@/components/system/RequireAuth";
import { WorkspaceList } from "@/components/workspace/WorkspaceList";

export default function WorkspaceIndexPage() {
  return (
    <RequireAuth>
      <WorkspaceList />
    </RequireAuth>
  );
}
