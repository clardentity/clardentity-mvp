type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function ChatPage({ params }: PageProps) {
  const { conversationId } = await params;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Conversation {conversationId}</h1>
        <p className="text-sm text-slate-500">
          Chat arrives in Phase 3 of the build.
        </p>
      </div>
    </div>
  );
}
