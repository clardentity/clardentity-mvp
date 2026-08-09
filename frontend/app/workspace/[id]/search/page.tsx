import { RequireAuth } from "@/components/system/RequireAuth";
import { WorkspaceSearch } from "@/components/workspace/WorkspaceSearch";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkspaceSearchPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <RequireAuth>
      <WorkspaceSearch workspaceId={id} />
    </RequireAuth>
  );
}
