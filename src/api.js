const KEY = "pcr";

export const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch (e) {
    return {};
  }
};

export const save = (cfg) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch (e) {}
};

// ---------------------------------------------------------------------------
// Mode démo : un faux PC dans le téléphone, rien n'est envoyé sur le réseau.
// Sert aux testeurs du Play Store et à essayer l'appli sans rien installer.
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const demo = { on: true, at: null, log: [], t0: Date.now() };

const DEMO_TEXT = {
  lock: "Verrouillage",
  sleep: "Mise en veille",
  hibernate: "Hibernation",
  logout: "Déconnexion",
  restart: "Redémarrage",
  shutdown: "Extinction",
};

async function demoCall(token, action, body = {}) {
  await wait(200);
  const now = Math.floor(Date.now() / 1000);
  const rec = (text) => demo.log.unshift({ t: now, text });

  // Le faux relais répond toujours, il rallume le faux PC
  if (token === "relay") {
    if (action === "wake") setTimeout(() => (demo.on = true), 1500);
    return { ok: true };
  }
  if (!demo.on) throw new Error("Failed to fetch");

  switch (action) {
    case "shutdown":
    case "sleep":
    case "hibernate":
      rec(DEMO_TEXT[action]);
      setTimeout(() => (demo.on = false), 1500);
      break;
    case "restart":
      rec(DEMO_TEXT[action]);
      setTimeout(() => (demo.on = false), 1500);
      setTimeout(() => (demo.on = true), 6500);
      break;
    case "lock":
    case "logout":
      rec(DEMO_TEXT[action]);
      break;
    case "screenoff":
      rec("Écran éteint");
      break;
    case "schedule":
      demo.at = now + (body.minutes || 15) * 60;
      rec("Extinction programmée dans " + body.minutes + " min");
      return { ok: true, shutdown_at: demo.at };
    case "cancel":
      demo.at = null;
      rec("Extinction programmée annulée");
      break;
    case "info":
      return {
        ok: true,
        uptime: Math.floor((Date.now() - demo.t0) / 1000) + 3 * 3600,
        mem_pct: 58,
        disk_free: 212e9,
        disk_total: 476e9,
        battery: { pct: 82, ac: true },
        shutdown_at: demo.at,
        history: demo.log.slice(0, 20),
      };
    case "apps":
      return { ok: true, apps: ["YouTube", "Spotify", "Bloc-notes"] };
    case "open":
      rec("Ouverture : " + body.name);
      break;
    case "url":
      try {
        rec("Site ouvert : " + new URL(body.url).host);
      } catch (e) {
        throw new Error("adresse invalide");
      }
      break;
    case "clip":
      rec("Texte copié (" + (body.text || "").length + " caractères)");
      break;
    default:
      break;
  }
  return { ok: true };
}

export async function call(base, token, action, body) {
  if (base === "demo") return demoCall(token, action, body);

  const r = await fetch(base.replace(/\/$/, "") + "/" + action, {
    method: "POST",
    headers: body ? { "X-Token": token, "Content-Type": "application/json" } : { "X-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || "Erreur " + r.status);
    err.code = r.status;
    throw err;
  }
  return j;
}
