import { RequireAuth } from "@/components/system/RequireAuth";
import { WorkspaceDetail } from "@/components/workspace/WorkspaceDetail";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkspacePage({ params }: PageProps) {
  const { id } = await params;

  return (
    <RequireAuth>
      <WorkspaceDetail workspaceId={id} />
    </RequireAuth>
  );
}
