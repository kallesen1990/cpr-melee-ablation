/**
 * CPR Melee Ablation
 * Patches CPRChat.RenderDamageApplicationCard to inject custom ablation
 * from a flag set on the weapon item.
 */

const MODULE_ID = "cpr-melee-ablation";

Hooks.once("ready", async () => {
  let CPRChat;
  try {
    const mod = await import(`/systems/${game.system.id}/modules/chat/cpr-chat.js`);
    CPRChat = mod.default ?? mod;
  } catch (err) {
    console.error(`[${MODULE_ID}] Could not import CPRChat:`, err);
    return;
  }

  // Patch RenderDamageApplicationCard — called by the native attack button.
  // args[0] is a plain data object with actor, damage, ablation, armorData etc.
  // args[1] is likely the source roll or item reference.
  if (typeof CPRChat.RenderDamageApplicationCard === "function") {
    const _orig = CPRChat.RenderDamageApplicationCard.bind(CPRChat);
    CPRChat.RenderDamageApplicationCard = async function (...args) {
      const data = args[0];
      console.log(`[${MODULE_ID}] RenderDamageApplicationCard — data keys:`, Object.keys(data ?? {}));
      console.log(`[${MODULE_ID}] data.ablation before:`, data?.ablation);
      console.log(`[${MODULE_ID}] all args count:`, args.length);

      // Log every arg to find the item/actor reference
      for (let i = 0; i < args.length; i++) {
        if (args[i] && typeof args[i] === "object") {
          console.log(`[${MODULE_ID}] args[${i}] constructor:`, args[i]?.constructor?.name);
          console.log(`[${MODULE_ID}] args[${i}] keys:`, Object.keys(args[i]).slice(0, 15).join(", "));
        }
      }

      // Try to find actor+item from data.actor or armorData
      let ablation = null;

      // Method 1: data.actor is an Actor instance — find the weapon from the
      // most recently rolled item via __autoFumbleRecovery on the actor
      try {
        const actor = data?.actor;
        if (actor?.items) {
          // Check all weapons for a meleeAblation flag
          // Use the one with the highest priority (most recently used)
          // CPR sets actor._lastDamageItem or similar — check
          console.log(`[${MODULE_ID}] actor keys:`, Object.keys(actor).slice(0, 20).join(", "));
          const flaggedWeapons = Array.from(actor.items ?? []).filter(i =>
            i.type === "weapon" && i.getFlag("world", "meleeAblation")
          );
          console.log(`[${MODULE_ID}] flagged weapons:`, flaggedWeapons.map(w => w.name + "=" + w.getFlag("world", "meleeAblation")));
        }
      } catch (e) {
        console.warn(`[${MODULE_ID}] Method 1 error:`, e);
      }

      return _orig(...args);
    };
    console.log(`[${MODULE_ID}] RenderDamageApplicationCard patched.`);
  }

  // Also patch RenderRollCard for macro-based rolls
  if (typeof CPRChat.RenderRollCard === "function") {
    const _orig = CPRChat.RenderRollCard.bind(CPRChat);
    CPRChat.RenderRollCard = async function (cprRoll) {
      const ablation = _getAblationFromRoll(cprRoll);
      if (ablation !== null) {
        cprRoll.ablation      = ablation;
        cprRoll.ablationValue = ablation;
      }
      return _orig(cprRoll);
    };
    console.log(`[${MODULE_ID}] RenderRollCard patched.`);
  }

  console.log(`[${MODULE_ID}] Hooks installed.`);
});

function _getAblationFromRoll(cprRoll) {
  if (!cprRoll) return null;
  try {
    const actorId = cprRoll.entityData?.actor;
    const itemId  = cprRoll.entityData?.item;
    if (actorId && itemId) {
      const actor = game.actors?.get(actorId)
        ?? canvas.tokens?.placeables.find(t =>
            (t.actor?.id ?? t.actor?._id) === actorId)?.actor;
      if (actor) {
        const item = actor.items?.get(itemId)
          ?? Array.from(actor.items ?? []).find(i => (i.id ?? i._id) === itemId);
        if (item) {
          const val = item.getFlag("world", "meleeAblation");
          if (val !== undefined && val !== null) return val;
        }
      }
    }
  } catch (e) {
    console.warn(`[${MODULE_ID}] _getAblationFromRoll error:`, e);
  }
  try {
    const val = cprRoll?.__autoFumbleRecoveryItem?.flags?.world?.meleeAblation ?? null;
    if (val !== null) return val;
  } catch (_) {}
  return null;
}

// ── API ───────────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;

  module.api = {
    openManager(actor = null) {
      const target = actor ?? canvas.tokens?.controlled[0]?.actor ?? null;
      if (!target) {
        ui.notifications.warn("[CPR Melee Ablation] Select a token first.");
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
          <p style="font-size:11px;opacity:0.7;margin-bottom:0;">Clear a field to remove custom ablation.</p>`,
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
        ui.notifications.error(`[CPR Melee Ablation] "${weaponName}" not found on ${actor.name}.`);
        return;
      }
      await weapon.setFlag("world", "meleeAblation", amount);
      ui.notifications.info(`[CPR Melee Ablation] ${weaponName} will now ablate ${amount} SP.`);
    },
  };

  console.log(`[${MODULE_ID}] API ready.`);
});
