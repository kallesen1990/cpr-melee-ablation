/**
 * CPR Melee Ablation
 *
 * Intercepts CPR damage roll rendering and injects a custom ablation value
 * from a flag set on the weapon item.
 *
 * Usage:
 *   Set the flag on any weapon item (world item or per-actor instance):
 *     item.setFlag("world", "meleeAblation", 2)
 *
 *   Or set it via the console with a token selected:
 *     canvas.tokens.controlled[0].actor.items
 *       .getName("My Weapon").setFlag("world", "meleeAblation", 2)
 *
 *   Clear it:
 *     item.unsetFlag("world", "meleeAblation")
 *
 * The flag value must be an integer >= 2. Weapons without the flag are
 * unaffected — they ablate the normal CPR default of 1 SP.
 */

const MODULE_ID = "cpr-melee-ablation";

Hooks.once("ready", async () => {
  let CPRChat;
  try {
    const mod = await import(
      `/systems/${game.system.id}/modules/chat/cpr-chat.js`
    );
    CPRChat = mod.default;
  } catch (err) {
    console.error(`[${MODULE_ID}] Could not import CPRChat:`, err);
    return;
  }

  if (!CPRChat || typeof CPRChat.RenderRollCard !== "function") {
    console.warn(`[${MODULE_ID}] CPRChat.RenderRollCard not found — ablation hook not installed.`);
    return;
  }

  const _original = CPRChat.RenderRollCard.bind(CPRChat);

  CPRChat.RenderRollCard = async function (cprRoll) {
    if (cprRoll && cprRoll.__autoFumbleRecoveryItem) {
      const itemData = cprRoll.__autoFumbleRecoveryItem;
      const ablation = itemData?.flags?.world?.meleeAblation ?? null;
      if (ablation !== null && Number.isInteger(ablation) && ablation >= 2) {
        cprRoll.ablation      = ablation;
        cprRoll.ablationValue = ablation;
      }
    }
    return _original(cprRoll);
  };

  console.log(`[${MODULE_ID}] Melee ablation hook installed.`);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;

  module.api = {
    openManager(actor = null) {
      const target = actor ?? canvas.tokens?.controlled[0]?.actor ?? null;
      if (!target) {
        ui.notifications.warn("[CPR Melee Ablation] Select a token first, or pass an actor.");
        return;
      }

      const escapeHtml = s =>
        String(s ?? "").replace(/[&<>"']/g, c =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

      const weapons = Array.from(target.items ?? [])
        .filter(i => i?.type === "weapon" && i.system)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      if (!weapons.length) {
        ui.notifications.warn(`[CPR Melee Ablation] ${target.name} has no weapons.`);
        return;
      }

      const rows = weapons.map(w => {
        const current = w.getFlag("world", "meleeAblation") ?? "";
        const detail  = [w.system?.weaponType ?? "", w.system?.damage ?? ""]
          .filter(Boolean).join(" / ");
        return `
          <tr>
            <td style="padding:4px 6px;">
              <strong>${escapeHtml(w.name)}</strong>
              ${detail ? `<div style="font-size:11px;opacity:0.75;">${escapeHtml(detail)}</div>` : ""}
            </td>
            <td style="padding:4px 6px;text-align:center;">
              <input type="number" data-item-id="${escapeHtml(w.id ?? w._id)}"
                value="${escapeHtml(String(current))}" min="1" max="10" placeholder="—"
                style="width:60px;text-align:center;" />
            </td>
          </tr>`;
      }).join("");

      new Dialog({
        title: `Ablation Manager — ${target.name}`,
        content: `
          <p style="margin-top:0;font-size:12px;opacity:0.8;">
            Set custom SP ablation per weapon. Leave blank to use the system default (1).
          </p>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #666;">Weapon</th>
                <th style="text-align:center;padding:4px 6px;border-bottom:1px solid #666;width:80px;">Ablation</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="font-size:11px;opacity:0.7;margin-bottom:0;">
            Clear a field to remove custom ablation.
          </p>`,
        buttons: {
          save: {
            label: "Save",
            callback: async html => {
              let saved = 0, cleared = 0;
              for (const input of html.find("input[data-item-id]")) {
                const item = target.items?.get?.(input.dataset.itemId);
                if (!item) continue;
                const raw = String(input.value ?? "").trim();
                if (raw === "" || raw === "0") {
                  if (item.getFlag("world", "meleeAblation") !== undefined) {
                    await item.unsetFlag("world", "meleeAblation");
                    cleared++;
                  }
                } else {
                  const val = parseInt(raw, 10);
                  if (Number.isInteger(val) && val >= 1 && val <= 10) {
                    await item.setFlag("world", "meleeAblation", val);
                    saved++;
                  }
                }
              }
              const parts = [];
              if (saved   > 0) parts.push(`${saved} updated`);
              if (cleared > 0) parts.push(`${cleared} cleared`);
              ui.notifications.info(`Ablation Manager: ${parts.join(", ") || "no changes"}.`);
            }
          },
          cancel: { label: "Cancel" }
        },
        default: "save",
      }).render(true);
    },

    async setAblation(actor, weaponName, amount) {
      const weapon = actor.items.getName(weaponName);
      if (!weapon) {
        ui.notifications.error(`[CPR Melee Ablation] Weapon "${weaponName}" not found on ${actor.name}.`);
        return;
      }
      await weapon.setFlag("world", "meleeAblation", amount);
      ui.notifications.info(`[CPR Melee Ablation] ${weaponName} will now ablate ${amount} SP.`);
    },
  };

  console.log(`[${MODULE_ID}] API ready.`);
});
