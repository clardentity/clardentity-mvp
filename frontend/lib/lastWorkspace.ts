/** Which workspace to open a new chat in when the user hasn't said - the one
 *  they were in last, on this device. A plain key rather than a store: it's
 *  written as a side effect of being somewhere and read once on the way in,
 *  never rendered. */
const KEY = "clardentity-last-workspace";

export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Storage blocked - the entry page falls back to the newest workspace.
  }
}

export function lastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
