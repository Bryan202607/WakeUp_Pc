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

// Fichiers : le dossier de partage du PC. Télécharger vers le téléphone, envoyer vers le PC.
export function FilesSheet({ route, go, say, close }) {
  const [path, setPath] = useState("");
  const [data, setData] = useState(undefined); // undefined = chargement, null = échec
  const [ups, setUps] = useState([]); // envois en cours ou terminés
  const input = useRef(null);

  const load = async (p) => {
    const j = await go("files", { body: { path: p } });
    setData(j || null);
    if (j) setPath(j.path);
  };

  useEffect(() => {
    load("");
  }, []);

  const join = (name) => (path ? path + "/" + name : name);
  const up = () => load(path.split("/").slice(0, -1).join("/"));

  // Le téléchargement est confié au navigateur du téléphone, qui le range dans Téléchargements
  const get = async (e) => {
    if (route.base === "demo") return say("Démo : « " + e.n + " » serait téléchargé");
    try {
      await openExternal(await downloadUrl(route.base, route.token, join(e.n)));
      say("Téléchargement lancé : " + e.n);
    } catch (err) {
      say("Injoignable. Tailscale ou la connexion directe est-il actif ?", "error");
    }
  };

  const patch = (id, change) => setUps((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));

  const pick = async (ev) => {
    const files = Array.from(ev.target.files || []);
    ev.target.value = "";
    const max = (data && data.max_upload) || Infinity;

    for (const f of files) {
      const id = Date.now() + Math.random();
      setUps((list) => [...list.slice(-4), { id, name: f.name, state: "run", pct: 0 }]);
      if (f.size > max) {
        patch(id, { state: "err", msg: "Trop gros (max " + size(max) + ")" });
        continue;
      }
      try {
        await upload(route.base, route.token, f, path, (p) => patch(id, { pct: Math.round(p * 100) }));
        patch(id, { state: "ok" });
      } catch (e) {
        patch(id, { state: "err", msg: e.message === "Failed to fetch" ? "Connexion perdue" : e.message });
      }
    }
    load(path);
  };

  return (
    <Sheet title="Fichiers" onClose={close}>
      {() => (
        <>
          <input ref={input} type="file" multiple hidden onChange={pick} />
          <button className="big" onClick={() => input.current && input.current.click()}>
            Envoyer vers le PC
          </button>

          {ups.length > 0 && (
            <>
              <div className="cap">Envois</div>
              <div className="list">
                {ups.map((u) => (
                  <Row
                    key={u.id}
                    flat
                    danger={u.state === "err"}
                    label={u.name}
                    detail={u.state === "run" ? u.pct + " %" : u.state === "ok" ? "Envoyé" : u.msg}
                  />
                ))}
              </div>
            </>
          )}

          <div className="cap">{path ? "Sur le PC : " + path : "Sur le PC"}</div>
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
                    <Row key={e.n} icon="doc" color="var(--secondary)" label={e.n} detail={size(e.s)} onClick={() => get(e)} />
                  )
                )}
              </div>
              {data.entries.length === 0 && (
                <p className="foot center">Dossier vide. Dépose des fichiers dans le dossier du PC pour les récupérer ici.</p>
              )}
              <p className="foot">
                Appuie sur un fichier pour le télécharger. Dossier sur le PC : {data.root}
                {data.more ? " (liste limitée à 500 éléments)" : ""}
              </p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
