/**
 * CPR Melee Ablation
 * Tracks the last rolled weapon and injects its meleeAblation flag
 * into the damage application card.
 */

const MODULE_ID = "cpr-melee-ablation";

// Store the last weapon item that triggered a damage roll
let _lastRolledItem = null;
let _lastRolledTimer = null;

Hooks.once("ready", async () => {

  // ── Intercept item.createRoll to capture which weapon is being rolled ──────
  const { CPRDamageRoll } = await import(
    `/systems/${game.system.id}/modules/rolls/cpr-rolls.js`
  ).catch(() => ({}));

  // Patch CPRItem.createRoll on all existing actor items
  // We do this via a hook that fires when actors are prepared
  const patchActorItems = (actor) => {
    if (!actor?.items) return;
    for (const item of actor.items) {
      if (item.type !== "weapon") continue;
      const proto = Object.getPrototypeOf(item);
      if (proto.__ablationPatched) continue;

      // Find createRoll on prototype chain
      let p = proto;
      while (p) {
        const desc = Object.getOwnPropertyDescriptor(p, "createRoll");
        if (desc?.value && !p.__ablationPatched) {
          p.__ablationPatched = true;
          const _orig = desc.value;
          p.createRoll = function(rollType, ...args) {
            const roll = _orig.call(this, rollType, ...args);
            if (rollType === "damage") {
              _lastRolledItem = this;
              // Clear after 30 seconds in case the roll is cancelled
              if (_lastRolledTimer) clearTimeout(_lastRolledTimer);
              _lastRolledTimer = setTimeout(() => { _lastRolledItem = null; }, 30000);
              console.log(`[${MODULE_ID}] Tracked damage roll: "${this.name}", flag:`, this.getFlag("world", "meleeAblation"));
            }
            return roll;
          };
          break;
        }
        p = Object.getPrototypeOf(p);
      }
    }
  };

  // Patch items on all current actors
  for (const actor of game.actors ?? []) patchActorItems(actor);
  // Patch items on tokens too (unlinked actors)
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor) patchActorItems(token.actor);
  }

  // Patch newly created/updated actors
  Hooks.on("createActor", patchActorItems);
  Hooks.on("updateActor", (actor) => patchActorItems(actor));

  // ── Intercept renderTemplate for the damage application card ──────────────
  const _origRenderTemplate = renderTemplate;
  window.renderTemplate = async function(path, data) {
    if (path && path.includes("cpr-damage-application-card")) {
      try {
        let ablation = null;

        // Method 1: use the tracked last rolled item
        if (_lastRolledItem) {
          const val = _lastRolledItem.getFlag("world", "meleeAblation");
          if (val !== undefined && val !== null) {
            ablation = val;
            console.log(`[${MODULE_ID}] Method 1 (tracked): "${_lastRolledItem.name}" ablation =`, val);
          }
          _lastRolledItem = null; // consume it
        }

        // Method 2: single flagged weapon on actor
        if (ablation === null && data?.actor?.items) {
          const flagged = Array.from(data.actor.items).filter(i =>
            i.type === "weapon" && i.getFlag("world", "meleeAblation")
          );
          if (flagged.length === 1) {
            ablation = flagged[0].getFlag("world", "meleeAblation");
            console.log(`[${MODULE_ID}] Method 2 (single): "${flagged[0].name}" ablation =`, ablation);
          }
        }

        if (ablation !== null && Number.isInteger(ablation) && ablation >= 2) {
          console.log(`[${MODULE_ID}] Injecting ablation =`, ablation);
          data.ablation = ablation;
        }
      } catch (e) {
        console.warn(`[${MODULE_ID}] renderTemplate error:`, e);
      }
    }
    return _origRenderTemplate(path, data);
  };

  console.log(`[${MODULE_ID}] Hooks installed.`);
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
