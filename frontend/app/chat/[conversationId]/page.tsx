import { RequireAuth } from "@/components/system/RequireAuth";
import { ChatView } from "@/components/chat/ChatView";

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function ChatPage({ params }: PageProps) {
  const { conversationId } = await params;

  return (
    <RequireAuth>
      <ChatView conversationId={conversationId} />
    </RequireAuth>
  );
}
