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

export async function call(base, token, action) {
  const r = await fetch(base.replace(/\/$/, "") + "/" + action, {
    method: "POST",
    headers: { "X-Token": token },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || "Erreur " + r.status);
    err.code = r.status;
    throw err;
  }
  return j;
}
