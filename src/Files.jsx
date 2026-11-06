import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import { upload, downloadUrl, openExternal } from "./api";

const size = (n) => {
  if (n < 1024) return n + " o";
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < 2) {
    v /= 1024;
    i++;
  }
  return (v >= 100 ? Math.round(v) : v.toFixed(1).replace(".0", "")) + " " + units[i];
};

// Fichiers et dossiers : les dossiers partagés du PC.
// Télécharger vers le téléphone (un dossier arrive en .zip), envoyer vers le PC (un dossier part en .zip et se décompresse tout seul).
export function FilesSheet({ route, go, say, close }) {
  const [path, setPath] = useState("");
  const [data, setData] = useState(undefined); // undefined = chargement, null = échec
  const [ups, setUps] = useState([]); // envois en cours ou terminés
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const files = useRef(null);
  const zips = useRef(null);

  const load = async (p) => {
    const j = await go("files", { body: { path: p } });
    setData(j || null);
    if (j) setPath(j.path);
  };

  useEffect(() => {
    load("");
  }, []);

  const join = (n) => (path ? path + "/" + n : n);
  const up = () => load(path.split("/").slice(0, -1).join("/"));
  const writable = Boolean(data) && !data.virtual;

  // Le téléchargement est confié au navigateur du téléphone, qui le range dans Téléchargements
  const fetchPath = async (rel, label) => {
    if (route.base === "demo") return say("Démo : « " + label + " » serait téléchargé");
    try {
      await openExternal(await downloadUrl(route.base, route.token, rel));
      say("Téléchargement lancé : " + label);
    } catch (err) {
      say("Injoignable. Tailscale ou la connexion directe est-il actif ?", "error");
    }
  };

  const patch = (id, change) => setUps((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));

  const send = async (f, zip) => {
    const id = Date.now() + Math.random();
    const max = (data && data.max_upload) || Infinity;
    setUps((list) => [...list.slice(-4), { id, name: f.name, state: "run", pct: 0, zip }]);
    if (f.size > max) return patch(id, { state: "err", msg: "Trop gros (max " + size(max) + ")" });
    if (zip && !/\.zip$/i.test(f.name)) return patch(id, { state: "err", msg: "Choisis un fichier .zip" });
    try {
      await upload(route.base, route.token, f, path, (p) => patch(id, { pct: Math.round(p * 100) }), { unzip: zip });
      patch(id, { state: "ok" });
    } catch (e) {
      patch(id, { state: "err", msg: e.message === "Failed to fetch" ? "Connexion perdue" : e.message });
    }
  };

  const pick = (zip) => async (ev) => {
    const list = Array.from(ev.target.files || []);
    ev.target.value = "";
    for (const f of list) await send(f, zip);
    load(path);
  };

  const mk = async () => {
    const j = await go("mkdir", { body: { path, name: name.trim() }, ok: "Dossier créé" });
    if (j) {
      setNaming(false);
      setName("");
      load(path);
    }
  };

  const state = (u) =>
    u.state === "run" ? (u.zip && u.pct >= 100 ? "Extraction…" : u.pct + " %") : u.state === "ok" ? (u.zip ? "Dossier prêt" : "Envoyé") : u.msg;

  return (
    <Sheet title="Fichiers" onClose={close}>
      {() => (
        <>
          <input ref={files} type="file" multiple hidden onChange={pick(false)} />
          <input ref={zips} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={pick(true)} />

          {writable && (
            <>
              <div className="cap">Actions</div>
              <div className="list">
                <Row icon="upload" color="var(--blue)" label="Envoyer des fichiers" onClick={() => files.current && files.current.click()} />
                <Row icon="folder" color="var(--indigo)" label="Envoyer un dossier (.zip)" onClick={() => zips.current && zips.current.click()} />
                <Row icon="folderplus" color="var(--teal)" label="Nouveau dossier" onClick={() => setNaming((v) => !v)} />
                {path && (
                  <Row
                    icon="download"
                    color="var(--green)"
                    label="Télécharger ce dossier (.zip)"
                    onClick={() => fetchPath(path, path.split("/").pop() + ".zip")}
                  />
                )}
              </div>
              {naming && (
                <div className="list">
                  <label className="field left">
                    <input
                      type="text"
                      value={name}
                      autoFocus
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && name.trim() && mk()}
                      placeholder="Nom du dossier"
                      autoCapitalize="sentences"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button className="mini" disabled={!name.trim()} onClick={mk}>
                      Créer
                    </button>
                  </label>
                </div>
              )}
            </>
          )}

          {ups.length > 0 && (
            <>
              <div className="cap">Envois</div>
              <div className="list">
                {ups.map((u) => (
                  <Row key={u.id} flat danger={u.state === "err"} label={u.name} detail={state(u)} />
                ))}
              </div>
            </>
          )}

          {data && data.outbox && path !== data.outbox && (
            <>
              <div className="cap">Du PC vers le téléphone</div>
              <div className="list">
                <Row icon="download" color="var(--green)" label="Reçus du PC" detail="Ce que le PC t'a envoyé" chevron onClick={() => load(data.outbox)} />
              </div>
            </>
          )}

          <div className="cap">{path ? "Sur le PC : " + path : data && data.virtual ? "Dossiers partagés" : "Sur le PC"}</div>
          {data === undefined && <p className="foot">Chargement…</p>}
          {data === null && <p className="foot">Impossible de lire le dossier du PC.</p>}
          {data && (
            <>
              <div className="list">
                {path && <Row flat chevron label="‹ Dossier parent" onClick={up} />}
                {data.entries.map((e) =>
                  e.d ? (
                    <Row key={e.n} icon="folder" color="var(--blue)" label={e.n} chevron onClick={() => load(join(e.n))} />
                  ) : (
                    <Row key={e.n} icon="doc" color="var(--secondary)" label={e.n} detail={size(e.s)} onClick={() => fetchPath(join(e.n), e.n)} />
                  )
                )}
              </div>
              {data.entries.length === 0 && (
                <p className="foot center">
                  {path && path === data.outbox
                    ? "Rien en attente. Sur le PC : clic droit sur un fichier, Envoyer vers, Telephone (WakeUp-Pc)."
                    : "Dossier vide. Dépose des fichiers dans le dossier du PC pour les récupérer ici."}
                </p>
              )}
              <p className="foot">
                Appuie sur un fichier pour le télécharger. Pour envoyer un dossier du téléphone, compresse-le d'abord en .zip avec ton
                gestionnaire de fichiers : le PC le décompresse tout seul.
                {data.virtual ? " Dossiers partagés : " : " Dossier sur le PC : "}
                {data.root}
                {data.more ? " (liste limitée à 500 éléments)" : ""}
              </p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
