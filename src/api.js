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
const keys = new Map(); // clé de signature déjà préparée, par token (on ne la recalcule pas à chaque mouvement de souris)
const hmacKey = (token) => {
  if (!keys.has(token)) keys.set(token, crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
  return keys.get(token);
};

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
  const key = await hmacKey(token);
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(method + "." + target)));
  return b + target + "&s=" + sig;
}

const fail = (j, status) => Object.assign(new Error(j.error || "Erreur " + status), { code: status, stale: Boolean(j.stale) });

// ---------------------------------------------------------------------------
// Mode démo : un faux PC dans le téléphone, rien n'est envoyé sur le réseau.
// Sert aux testeurs du Play Store et à essayer l'appli sans rien installer.
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const demo = {
  on: true,
  at: null,
  awake: null,
  locked: false,
  clip: "Texte copié sur le PC de démonstration",
  sched: [{ id: "a1b2c3", time: "07:00", days: [0, 1, 2, 3, 4], on: true, label: "" }],
  dl: [],
  procs: [
    { n: "chrome.exe", c: 14, m: 1850000, p: false },
    { n: "Code.exe", c: 6, m: 920000, p: false },
    { n: "Spotify.exe", c: 5, m: 410000, p: false },
    { n: "explorer.exe", c: 1, m: 180000, p: true },
    { n: "notepad.exe", c: 2, m: 24000, p: false },
  ],
  log: [],
  t0: Date.now(),
};
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
    if (action === "schedule_list") return { ok: true, items: demo.sched, now: "07:00", tz: "UTC" };
    if (action === "schedule_add") {
      const item = { id: Math.random().toString(16).slice(2, 8), time: body.time, days: body.days || [], on: true, label: body.label || "" };
      demo.sched.push(item);
      return { ok: true, item };
    }
    if (action === "schedule_del") demo.sched = demo.sched.filter((i) => i.id !== body.id);
    if (action === "schedule_toggle") demo.sched.forEach((i) => i.id === body.id && (i.on = Boolean(body.on)));
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
      demo.locked = true;
      rec(DEMO_TEXT[action]);
      break;
    case "logout":
      rec(DEMO_TEXT[action]);
      break;
    case "ping":
      return { ok: true, locked: demo.locked };
    case "unlock":
      if (!demo.locked) throw new Error("le PC n'est pas verrouillé");
      if (body.code !== "1234") throw new Error("code de déverrouillage incorrect (démo : 1234)");
      demo.locked = false;
      rec("PC déverrouillé à distance");
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
        awake_until: demo.awake && demo.awake > now ? demo.awake : null,
        history: demo.log.slice(0, 20),
      };
    case "apps":
      return { ok: true, apps: ["YouTube", "Spotify", "Bloc-notes"] };
    case "files": {
      const p = body.path || "";
      return { ok: true, path: demoTree[p] ? p : "", root: "C:\\Users\\Demo\\WakeUp-Pc", max_upload: 1024 * 1048576, entries: demoTree[p] || demoTree[""], more: false };
    }
    case "mkdir": {
      const dir = body.path || "";
      const key = demoTree[dir] ? dir : "";
      const name = (body.name || "Dossier").trim();
      if (demoTree[key].some((e) => e.n === name)) throw new Error("ce nom existe déjà");
      demoTree[key].push({ n: name, d: true, s: 0, m: now });
      demoTree[(key ? key + "/" : "") + name] = [];
      rec("Dossier créé : " + name);
      return { ok: true, name };
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
      demo.clip = body.text || "";
      rec("Texte copié (" + demo.clip.length + " caractères)");
      break;
    case "clipget":
      return { ok: true, text: demo.clip, truncated: false };
    case "awake":
      demo.awake = body.minutes ? now + body.minutes * 60 : null;
      rec(body.minutes ? "PC gardé éveillé " + body.minutes + " min" : "Veille autorisée à nouveau");
      return { ok: true, awake_until: demo.awake };
    case "procs":
      return { ok: true, procs: demo.procs.map((p) => ({ ...p })) };
    case "kill":
      demo.procs = demo.procs.filter((p) => p.n !== body.name);
      rec("Programme fermé : " + body.name);
      break;
    case "shortcuts":
      return { ok: true, shortcuts: [{ n: "Mon adresse IP", confirm: false }, { n: "Vider la corbeille", confirm: true }] };
    case "run":
      rec("Raccourci : " + body.name);
      if (body.name === "Mon adresse IP") return { ok: true, output: "Carte Wi-Fi\n  Adresse IPv4 : 192.168.43.2\n  Passerelle   : 192.168.43.1", code: 0 };
      break;
    case "dl_start": {
      const job = { id: Math.random().toString(16).slice(2, 10), name: (body.name || (body.url || "").split("/").pop() || "fichier").slice(0, 40), got: 0, total: 8000000, state: "run", error: "" };
      demo.dl.unshift(job);
      rec("Téléchargement lancé");
      return { ok: true, id: job.id };
    }
    case "dl_status":
      demo.dl.forEach((j) => {
        if (j.state === "run") {
          j.got = Math.min(j.total, j.got + 2500000);
          if (j.got >= j.total) j.state = "ok";
        }
      });
      return { ok: true, jobs: demo.dl.map((j) => ({ ...j })) };
    case "dl_cancel":
      demo.dl.forEach((j) => j.id === body.id && j.state === "run" && ((j.state = "err"), (j.error = "annulé")));
      break;
    case "streaminfo":
      return { ok: true, fps: 24, w: 640, kb: 14 };
    case "mouse":
    case "key":
      return { ok: true };
    default:
      break;
  }
  return { ok: true };
}

async function demoUpload(file, dir, onProgress, opts = {}) {
  for (let i = 1; i <= 5; i++) {
    await wait(150);
    if (onProgress) onProgress(i / 5);
  }
  const now = Math.floor(Date.now() / 1000);
  const key = demoTree[dir] ? dir : "";
  if (opts.unzip) {
    await wait(400); // extraction
    const name = file.name.replace(/\.zip$/i, "");
    demoTree[key].push({ n: name, d: true, s: 0, m: now });
    demoTree[(key ? key + "/" : "") + name] = [];
    demo.log.unshift({ t: now, text: "Dossier reçu : " + name });
    return { ok: true, name, count: 1, size: file.size };
  }
  demoTree[key].push({ n: file.name, d: false, s: file.size, m: now });
  demo.log.unshift({ t: now, text: "Fichier reçu : " + file.name });
  return { ok: true, name: file.name, size: file.size };
}

// Adresse d'une capture d'écran (signée, valable une seule fois)
export async function shotUrl(base, token, params = {}) {
  if (base === "demo") {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a6df0"/><stop offset="1" stop-color="#8e54e9"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><rect x="180" y="110" width="620" height="400" rx="14" fill="#ffffff"/><rect x="180" y="110" width="620" height="40" rx="14" fill="#e8e8ed"/><text x="210" y="138" font-family="sans-serif" font-size="18" fill="#444">Bloc-notes</text><text x="210" y="200" font-family="sans-serif" font-size="22" fill="#222">Écran de démonstration</text><text x="210" y="240" font-family="sans-serif" font-size="18" fill="#666">Ici s\'affichera l\'écran de ton PC.</text><rect y="672" width="1280" height="48" fill="#1c1c1e" opacity="0.85"/></svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  return signedUrl(base, token, "GET", "/shot", params);
}

// Adresse du flux vidéo de l'écran (signée, valable une seule fois)
export async function streamUrl(base, token, params = {}) {
  if (base === "demo") return shotUrl("demo", token);
  return signedUrl(base, token, "GET", "/stream", params);
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
    // un ping doit répondre vite, sinon le statut reste « Vérification… » ; le déverrouillage prend une dizaine de secondes
    const ms = action === "ping" ? 4000 : action === "unlock" ? 45000 : 10000;
    return tfetch(url, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined }, ms);
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
// opts.unzip : le fichier est un .zip, le PC l'extrait dans un nouveau dossier (c'est ainsi qu'on envoie un dossier)
export async function upload(base, token, file, dir, onProgress, opts = {}) {
  if (base === "demo") return demoUpload(file, dir, onProgress, opts);
  const b = base.replace(/\/+$/, "");

  const once = async (force) => {
    const url = await signedUrl(b, token, "PUT", "/upload", { name: file.name, dir: dir || "", ...(opts.unzip ? { unzip: "1" } : {}) }, force);
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

// ---------------------------------------------------------------------------
// Connexion directe : chercher le PC sur le réseau et diagnostiquer
// ---------------------------------------------------------------------------
async function quickJson(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Y a-t-il un agent WakeUp-Pc à cette adresse ?
export async function probeLan(host, port = 8766, ms = 700) {
  try {
    const j = await quickJson("http://" + host + ":" + port + "/time", ms);
    return j && j.app === "wakeup-pc" ? { url: "http://" + host + ":" + port, mode: j.mode } : null;
  } catch (e) {
    return null;
  }
}

// Réseaux les plus courants : point d'accès Android (43), point d'accès Windows (137), box (0, 1, 2...)
const COMMON = ["192.168.43", "192.168.137", "192.168.0", "192.168.1", "192.168.2", "192.168.100", "192.168.8", "10.0.0", "10.0.1", "172.20.10"];

export async function scanLan(onProgress, hint) {
  if (!isNative()) return [];
  const prefixes = [];
  const m = /^(?:https?:\/\/)?(\d+\.\d+\.\d+)\.\d+/.exec(hint || "");
  if (m) prefixes.push(m[1]); // on commence par le réseau de la dernière adresse connue
  for (const p of COMMON) if (!prefixes.includes(p)) prefixes.push(p);

  for (const prefix of prefixes) {
    if (onProgress) onProgress(prefix + ".x");
    const hosts = Array.from({ length: 254 }, (_, i) => prefix + "." + (i + 1));
    const found = [];
    let next = 0;
    const worker = async () => {
      while (next < hosts.length) {
        const r = await probeLan(hosts[next++]);
        if (r) found.push(r);
      }
    };
    await Promise.all(Array.from({ length: 48 }, worker));
    if (found.length) return found; // on s'arrête au premier réseau où quelque chose répond
  }
  return [];
}

// Diagnostic pas à pas : renvoie une liste de { ok, text }
export async function testDirect(url, token) {
  if (!isNative()) {
    return [{ ok: false, text: "Cette page web ne peut pas joindre une adresse locale. Installe l'appli Android (APK) pour utiliser la connexion directe." }];
  }
  const base = normLan(url);
  if (!base) return [{ ok: false, text: "Aucune adresse « Direct » dans les réglages." }];

  const steps = [];
  const t0 = Date.now();
  let j;
  try {
    j = await quickJson(base + "/time", 4000);
  } catch (e) {
    return [
      {
        ok: false,
        text:
          "Aucune réponse de " + base + ". Vérifie dans l'ordre : le PC et le téléphone sont sur le même réseau ; l'agent est lancé avec LAN=1 ; le pare-feu Windows laisse passer le port (commande dans le guide) ; les données mobiles sont coupées si le Wi-Fi n'a pas internet.",
      },
    ];
  }
  if (!j || j.app !== "wakeup-pc") {
    return [{ ok: false, text: "Quelque chose répond à cette adresse, mais ce n'est pas l'agent WakeUp-Pc. Mauvaise adresse ou mauvais port ?" }];
  }
  steps.push({ ok: true, text: "L'agent répond (" + (j.mode === "relay" ? "relais" : "PC") + ", " + (Date.now() - t0) + " ms)." });
  if (j.origin_ok === false) {
    steps.push({ ok: false, text: "L'agent refuse cette appli : ajoute https://localhost dans ALLOWED_ORIGIN (séparé par une virgule) et relance l'agent." });
    return steps;
  }
  steps.push({ ok: true, text: "L'agent accepte cette appli." });
  if (!token) {
    steps.push({ ok: false, text: "Aucun token dans les réglages." });
    return steps;
  }
  try {
    await call(base, token, "ping");
    steps.push({ ok: true, text: "Connexion signée acceptée : tout fonctionne." });
  } catch (e) {
    steps.push({
      ok: false,
      text:
        e.code === 401
          ? "Token refusé : il doit être identique à celui de l'agent."
          : e.code === 429
          ? "L'agent est bloqué quelques minutes après trop d'essais. Attends, ou relance-le."
          : "Échec : " + e.message,
    });
  }
  return steps;
}
