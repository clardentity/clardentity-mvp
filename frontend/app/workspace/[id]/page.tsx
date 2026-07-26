type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkspacePage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Workspace {id}</h1>
        <p className="text-sm text-slate-500">
          Workspaces arrive in Phase 2 of the build.
        </p>
      </div>
    </div>
  );
}
