// The one-click way to ask for less UI.
//
// A `messageAction`'s run gets no RPC client, so this cannot store a
// preference on the server: it puts the request in the composer instead, where
// the user can add to it, edit it, or drop it. That is also the honest shape —
// the level itself is the plugin's setting (`bb genui verbosity`), while this
// is one reply's feedback.
import type { PluginMessageActionContext } from "@get-bb/plugin-sdk/app";

/** What lands in the composer; short enough to leave the user's own words room. */
export const LESS_UI_REQUEST =
  "Less UI: answer in prose and add a block only when it carries something prose cannot — a table, a real series, saved tool output, or a choice I have to make.";

/**
 * Puts the request in the thread's composer after whatever is already drafted.
 * Only an assistant reply can have too much UI, and a timeline without a
 * composer (an embedded ThreadChat) has nowhere to put it: both are a no-op
 * that reports it did nothing, so the host does not offer the action for
 * nothing.
 */
export function insertLessUiRequest(context: PluginMessageActionContext): boolean {
  if (context.message.role !== "assistant") return false;
  const composer = context.composer;
  if (composer === null) return false;
  composer.insert(LESS_UI_REQUEST, { at: "end", block: true });
  return true;
}
