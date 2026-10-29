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
 * The host shows a message action on user messages too and has no way to hide
 * it there, so on one (only a reply can have too much UI) and on a surface
 * without a composer this does nothing.
 */
export function insertLessUiRequest(context: PluginMessageActionContext): void {
  if (context.message.role !== "assistant") return;
  context.composer?.insert(LESS_UI_REQUEST, { at: "end", block: true });
}
