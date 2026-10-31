import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

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

// La connexion directe (http sur le réseau local) ne marche que dans l'appli Android
export const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (e) {
    return false;
  }
};

// "192.168.43.2" devient "http://192.168.43.2:8766"
export const normLan = (u) => {
  u = (u || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  u = u.replace(/\/+$/, "");
  const host = u.replace(/^https?:\/\//i, "").split("/")[0];
  if (!/:\d+$/.test(host)) u += ":8766";
  return u;
};

// Ouvre un lien hors de l'appli (le téléchargement est alors géré par le navigateur du téléphone)
export const openExternal = (url) => (isNative() ? Browser.open({ url }) : window.open(url, "_blank", "noopener"));

// ---------------------------------------------------------------------------
// Requêtes signées (connexion directe et fichiers) : le token ne circule jamais.
// signature = HMAC-SHA256(token, METHODE + "." + adresse), avec l'heure et un aléa dans l'adresse.
// ---------------------------------------------------------------------------
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const offsets = {}; // écart d'horloge PC / téléphone, par adresse

// fetch avec délai maximum : une adresse injoignable ne bloque pas l'appli
async function tfetch(url, opts, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    throw new Error("Failed to fetch");
  } finally {
    clearTimeout(timer);
  }
}

async function clockOffset(base, force) {
  if (!force && base in offsets) return offsets[base];
  const r = await tfetch(base + "/time", {}, 5000);
  const j = await r.json();
  offsets[base] = j.t - Date.now();
  return offsets[base];
}

export async function signedUrl(base, token, method, path, params = {}, force = false) {
  const b = base.replace(/\/+$/, "");
  const off = await clockOffset(b, force);
  const q = Object.entries(params)
    .map(([k, v]) => k + "=" + enc(String(v)))
    .join("&");
  const nonce = hex(crypto.getRandomValues(new Uint8Array(8)));
  const target = path + "?" + (q ? q + "&" : "") + "t=" + (Date.now() + off) + "&n=" + nonce;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(method + "." + target)));
  return b + target + "&s=" + sig;
}

const fail = (j, status) => Object.assign(new Error(j.error || "Erreur " + status), { code: status, stale: Boolean(j.stale) });

// ---------------------------------------------------------------------------
// Mode démo : un faux PC dans le téléphone, rien n'est envoyé sur le réseau.
// Sert aux testeurs du Play Store et à essayer l'appli sans rien installer.
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const demo = { on: true, at: null, log: [], t0: Date.now() };
const day = Math.floor(Date.now() / 1000) - 86400;
const demoTree = {
  "": [
    { n: "Photos", d: true, s: 0, m: day },
    { n: "Cours-electronique.pdf", d: false, s: 2400000, m: day },
    { n: "notes.txt", d: false, s: 1200, m: day },
  ],
  Photos: [
    { n: "vacances.jpg", d: false, s: 3100000, m: day },
    { n: "famille.jpg", d: false, s: 2700000, m: day },
  ],
};

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
    case "files": {
      const p = body.path || "";
      return { ok: true, path: demoTree[p] ? p : "", root: "C:\\Users\\Demo\\WakeUp-Pc", max_upload: 1024 * 1048576, entries: demoTree[p] || demoTree[""], more: false };
    }
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

async function demoUpload(file, dir, onProgress) {
  for (let i = 1; i <= 5; i++) {
    await wait(150);
    if (onProgress) onProgress(i / 5);
  }
  const key = demoTree[dir] ? dir : "";
  demoTree[key].push({ n: file.name, d: false, s: file.size, m: Math.floor(Date.now() / 1000) });
  demo.log.unshift({ t: Math.floor(Date.now() / 1000), text: "Fichier reçu : " + file.name });
  return { ok: true, name: file.name, size: file.size };
}

// ---------------------------------------------------------------------------
// Appels au PC ou au relais
// ---------------------------------------------------------------------------
export async function call(base, token, action, body) {
  if (base === "demo") return demoCall(token, action, body);

  const b = base.replace(/\/+$/, "");
  const signed = b.startsWith("http://"); // connexion directe : requêtes signées, jamais de token en clair

  const send = async (force) => {
    const url = signed ? await signedUrl(b, token, "POST", "/" + action, {}, force) : b + "/" + action;
    const headers = {};
    if (!signed) headers["X-Token"] = token;
    if (body) headers["Content-Type"] = "application/json";
    return tfetch(url, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined }, 15000);
  };

  let r = await send(false);
  let j = await r.json().catch(() => ({}));
  if (signed && j.stale) {
    r = await send(true); // l'horloge a changé : on recale et on réessaie une fois
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) throw fail(j, r.status);
  return j;
}

// Envoie un fichier du téléphone vers le dossier de partage du PC
export async function upload(base, token, file, dir, onProgress) {
  if (base === "demo") return demoUpload(file, dir, onProgress);
  const b = base.replace(/\/+$/, "");

  const once = async (force) => {
    const url = await signedUrl(b, token, "PUT", "/upload", { name: file.name, dir: dir || "" }, force);
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => {
        let j = {};
        try {
          j = JSON.parse(x.responseText);
        } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(j);
        else reject(fail(j, x.status));
      };
      x.onerror = () => reject(new Error("Failed to fetch"));
      x.send(file);
    });
  };

  try {
    return await once(false);
  } catch (e) {
    if (e.stale) return once(true);
    throw e;
  }
}

// Lien de téléchargement signé, valable quelques minutes, pour un seul fichier
export const downloadUrl = (base, token, path) => signedUrl(base, token, "GET", "/dl", { path });
