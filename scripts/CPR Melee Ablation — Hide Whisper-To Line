/**
 * CPR Melee Ablation — Hide Whisper-To Line
 * Always hides the "To: <recipients>" line Foundry renders on whispered/
 * blind chat messages (including Private GM Rolls). No setting/toggle —
 * this is permanently on for whoever has the module active.
 *
 * Client-side only: this is cosmetic and affects only the user who has
 * the module enabled, not what's actually stored on the message.
 */
 
Hooks.on("renderChatMessage", (message, html, data) => {
  html.find(".whisper-to").remove();
});
 
// Strip it from any messages already sitting in the log on first load
Hooks.once("ready", () => {
  document.querySelectorAll("#chat-log .whisper-to").forEach(el => el.remove());
});
