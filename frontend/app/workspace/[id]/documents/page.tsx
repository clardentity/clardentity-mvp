import { RequireAuth } from "@/components/system/RequireAuth";
import { WorkspaceDocuments } from "@/components/workspace/WorkspaceDocuments";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkspaceDocumentsPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <RequireAuth>
      <WorkspaceDocuments workspaceId={id} />
    </RequireAuth>
  );
}
