// Code PIN de l'appli : 6 chiffres, gardé sur le téléphone sous forme d'empreinte
// (PBKDF2 + sel aléatoire). Le code lui-même n'est jamais enregistré.
const PIN_KEY = "pcr_pin";
const FAIL_KEY = "pcr_pinfail";
const enc = new TextEncoder();

const toB64 = (u8) => btoa(String.fromCharCode(...u8));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt) {
  if (!window.crypto || !window.crypto.subtle) throw new Error("Le chiffrement n'est pas disponible ici.");
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

const readFails = () => {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY)) || { n: 0, until: 0 };
  } catch (e) {
    return { n: 0, until: 0 };
  }
};

const fmtWait = (ms) => {
  const s = Math.ceil(ms / 1000);
  return s < 90 ? s + " s" : Math.ceil(s / 60) + " min";
};

export const hasPin = () => {
  try {
    return Boolean(localStorage.getItem(PIN_KEY));
  } catch (e) {
    return false;
  }
};

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);
  localStorage.setItem(PIN_KEY, JSON.stringify({ s: toB64(salt), h: toB64(hash) }));
  localStorage.removeItem(FAIL_KEY);
}

export const clearPin = () => {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(FAIL_KEY);
};

// Efface tout sur cet appareil (code oublié) puis recharge l'appli
export const wipeAll = () => {
  try {
    localStorage.clear();
  } catch (e) {}
  window.location.reload();
};

// Renvoie { ok: true } ou { ok: false, msg }
export async function checkPin(pin) {
  const f = readFails();
  const left = f.until - Date.now();
  if (left > 0) return { ok: false, msg: "Trop d'essais. Réessaie dans " + fmtWait(left) };

  let rec = null;
  try {
    rec = JSON.parse(localStorage.getItem(PIN_KEY));
  } catch (e) {}
  if (!rec) return { ok: true };

  const hash = await derive(pin, fromB64(rec.s));
  const good = fromB64(rec.h);
  let diff = hash.length ^ good.length;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ good[i];
  if (diff === 0) {
    localStorage.removeItem(FAIL_KEY);
    return { ok: true };
  }

  // Après 5, 10, 15… erreurs : attente de 1 min, 5 min, puis 15 min
  const n = f.n + 1;
  const until = n % 5 === 0 ? Date.now() + (n >= 15 ? 900 : n >= 10 ? 300 : 60) * 1000 : 0;
  localStorage.setItem(FAIL_KEY, JSON.stringify({ n, until }));
  return { ok: false, msg: until ? "Trop d'essais. Réessaie dans " + fmtWait(until - Date.now()) : "Code incorrect" };
}
