import { RequireAuth } from "@/components/system/RequireAuth";
import { StartChat } from "@/components/chat/StartChat";

/** Where sign-in, sign-up and the welcome questions all land. Resolves a
 *  workspace and a chat and goes there; see StartChat. */
export default function StartPage() {
  return (
    <RequireAuth>
      <StartChat />
    </RequireAuth>
  );
}
