/**
 * CPR Melee Ablation
 * Hooks into renderTemplate for cpr-damage-application-card.hbs to inject
 * custom ablation from a flag set on the weapon item.
 */

const MODULE_ID = "cpr-melee-ablation";

Hooks.once("ready", () => {
  // Patch renderTemplate — confirmed to fire with data.ablation on the damage card
  const _origRenderTemplate = renderTemplate;

  window.renderTemplate = async function(path, data) {
    // Only intercept the damage application card
    if (path && path.includes("cpr-damage-application-card")) {
      try {
        // data.actor is the live Actor object — find flagged weapons
        const actor = data?.actor;
        if (actor?.items) {
          // The last-used weapon is tracked by CPR on the actor
          // Try to find which weapon was just used via currentWeapon or flagged weapons
          let ablation = null;

          // Check currentWeapon reference first
          const currentWeaponId = actor.system?.externalData?.currentWeapon?.id;
          if (currentWeaponId) {
            const weapon = actor.items.get(currentWeaponId);
            const val = weapon?.getFlag("world", "meleeAblation");
            if (val) {
              ablation = val;
              console.log(`[${MODULE_ID}] currentWeapon "${weapon.name}" flag =`, val);
            }
          }

          // If no currentWeapon match, check all flagged weapons
          // and use the one that matches the damage type/weapon type in data
          if (ablation === null) {
            const flaggedWeapons = Array.from(actor.items).filter(i =>
              i.type === "weapon" && i.getFlag("world", "meleeAblation")
            );
            if (flaggedWeapons.length === 1) {
              // Only one flagged weapon — use it
              ablation = flaggedWeapons[0].getFlag("world", "meleeAblation");
              console.log(`[${MODULE_ID}] Single flagged weapon "${flaggedWeapons[0].name}" ablation =`, ablation);
            } else if (flaggedWeapons.length > 1) {
              // Multiple flagged weapons — match by weaponType in armorData or location
              console.log(`[${MODULE_ID}] Multiple flagged weapons — need smarter matching`);
            }
          }

          if (ablation !== null && Number.isInteger(ablation) && ablation >= 2) {
            console.log(`[${MODULE_ID}] Injecting ablation =`, ablation, "into damage card");
            data.ablation = ablation;
            data.shieldAblation = data.shieldAblation ?? 0;
          }
        }
      } catch (e) {
        console.warn(`[${MODULE_ID}] renderTemplate hook error:`, e);
      }
    }

    return _origRenderTemplate(path, data);
  };

  console.log(`[${MODULE_ID}] renderTemplate hook installed.`);
});

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
