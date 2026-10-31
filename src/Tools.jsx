import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import Icon from "./icons";

const useTick = (ms = 20000) => {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
};

const hhmm = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const when = (t) => {
  const d = new Date(t * 1000);
  if (d.toDateString() === new Date().toDateString()) return hhmm(t);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + hhmm(t);
};

const dur = (min) => {
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return h + " h" + (m ? " " + String(m).padStart(2, "0") : "");
  return Math.floor(h / 24) + " j " + (h % 24) + " h";
};

const gb = (b) => Math.round(b / 1e9) + " Go";

// ---------------------------------------------------------------- Éteindre dans…
const PRESETS = [
  [15, "15 minutes"],
  [30, "30 minutes"],
  [60, "1 heure"],
  [120, "2 heures"],
  [240, "4 heures"],
];

export function TimerSheet({ go, close }) {
  const [at, setAt] = useState(null); // heure d'extinction prévue (secondes), ou null
  useTick();

  useEffect(() => {
    go("info").then((j) => j && setAt(j.shutdown_at || null));
  }, []);

  const plan = async (m, label) => {
    const j = await go("schedule", { body: { minutes: m }, ok: "Extinction dans " + label });
    if (j) setAt(j.shutdown_at);
  };

  const cancel = async () => {
    const j = await go("cancel", { ok: "Extinction annulée" });
    if (j) setAt(null);
  };

  const left = at ? Math.max(0, Math.round((at * 1000 - Date.now()) / 60000)) : 0;

  return (
    <Sheet title="Éteindre dans…" onClose={close}>
      {() => (
        <>
          {at && (
            <>
              <div className="cap">Prévue</div>
              <div className="list">
                <Row flat label={"À " + hhmm(at)} detail={"dans " + dur(left)} />
                <Row flat accent label="Annuler l'extinction" onClick={cancel} />
              </div>
            </>
          )}
          <div className="cap">{at ? "Changer la durée" : "Durée"}</div>
          <div className="list">
            {PRESETS.map(([m, label]) => (
              <Row key={m} flat label={label} onClick={() => plan(m, label)} />
            ))}
          </div>
          <p className="foot">Tu peux annuler à tout moment, depuis ici.</p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Autres actions
export function OtherSheet({ actions, tap, armed, close }) {
  return (
    <Sheet title="Autres actions" onClose={close}>
      {() => (
        <div className="list">
          {actions.map((a) => (
            <Row
              key={a.id}
              icon={a.icon}
              color={a.color}
              label={a.label}
              danger={a.danger}
              armed={armed === a.id}
              onClick={() => tap(a)}
            />
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Médias et volume
const KEYS = [
  ["prev", "prev", "Précédent"],
  ["play", "play", "Lecture / pause"],
  ["next", "next", "Suivant"],
  ["vol_down", "voldown", "Volume moins"],
  ["mute", "mute", "Muet"],
  ["vol_up", "volup", "Volume plus"],
];

export function MediaSheet({ go, close }) {
  return (
    <Sheet title="Médias et volume" onClose={close}>
      {() => (
        <>
          <div className="mpad">
            {KEYS.map(([id, icon, label]) => (
              <button key={id} className={"mbtn" + (id === "play" ? " main" : "")} aria-label={label} onClick={() => go(id)}>
                <Icon name={icon} size={28} />
              </button>
            ))}
          </div>
          <p className="foot center">Agit sur le son et la lecture de l'ordinateur.</p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Envoyer au PC
export function SendSheet({ go, close }) {
  const [apps, setApps] = useState(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    go("apps").then((j) => setApps(j ? j.apps : []));
  }, []);

  const openUrl = () => {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    go("url", { body: { url: u }, ok: "Site ouvert sur le PC" });
  };

  const copy = async () => {
    const j = await go("clip", { body: { text }, ok: "Texte copié sur le PC" });
    if (j) setText("");
  };

  return (
    <Sheet title="Envoyer au PC" onClose={close}>
      {() => (
        <>
          <div className="cap">Applications</div>
          {apps && apps.length > 0 ? (
            <div className="list">
              {apps.map((n) => (
                <Row key={n} flat label={n} detail="Ouvrir" onClick={() => go("open", { body: { name: n }, ok: n + " : ouverture" })} />
              ))}
            </div>
          ) : (
            <p className="foot">
              {apps === null ? "Chargement…" : "Aucune appli autorisée. Crée un fichier apps.json à côté de agent.py (voir le guide)."}
            </p>
          )}

          <div className="cap">Site web</div>
          <div className="list">
            <label className="field left">
              <input
                type="text"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && openUrl()}
                placeholder="exemple.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button className="mini" disabled={!url.trim()} onClick={openUrl}>
                Ouvrir
              </button>
            </label>
          </div>

          <div className="cap">Presse-papiers du PC</div>
          <div className="list">
            <textarea
              className="area"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              placeholder="Écris ou colle un texte"
            />
          </div>
          <button className="big" disabled={!text} onClick={copy}>
            Copier sur le PC
          </button>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Infos et historique
export function InfoSheet({ go, close }) {
  const [d, setD] = useState(undefined); // undefined = chargement, null = échec

  useEffect(() => {
    go("info").then((j) => setD(j || null));
  }, []);

  return (
    <Sheet title="Infos du PC" onClose={close}>
      {() => {
        if (d === undefined) return <p className="foot center">Chargement…</p>;
        if (d === null) return <p className="foot center">Impossible de lire les infos.</p>;
        return (
          <>
            <div className="list">
              {d.uptime != null && <Row flat label="Allumé depuis" detail={dur(Math.max(1, Math.floor(d.uptime / 60)))} />}
              {d.mem_pct != null && <Row flat label="Mémoire utilisée" detail={d.mem_pct + " %"} />}
              {d.disk_total ? <Row flat label="Disque libre" detail={gb(d.disk_free) + " / " + gb(d.disk_total)} /> : null}
              {d.battery && (
                <Row flat label="Batterie" detail={d.battery.pct + " %" + (d.battery.ac ? " · branché" : "")} />
              )}
            </div>

            <div className="cap">Dernières actions</div>
            {d.history && d.history.length > 0 ? (
              <div className="list">
                {d.history.map((h, i) => (
                  <Row key={i} flat danger={h.bad} label={h.text} detail={when(h.t)} />
                ))}
              </div>
            ) : (
              <p className="foot">Rien pour l'instant.</p>
            )}
          </>
        );
      }}
    </Sheet>
  );
}
