import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import Icon from "./icons";
import { fmtSize } from "./util";

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

// ---------------------------------------------------------------- Minuteries : extinction, veille, réveil
const PRESETS = [
  [15, "15 minutes"],
  [30, "30 minutes"],
  [60, "1 heure"],
  [120, "2 heures"],
  [240, "4 heures"],
];

const STAY = [
  [30, "30 minutes"],
  [60, "1 heure"],
  [120, "2 heures"],
  [240, "4 heures"],
  [480, "8 heures"],
];

export function TimerSheet({ go, close, openWake }) {
  const [info, setInfo] = useState({ at: null, awake: null }); // extinction prévue, veille bloquée jusqu'à (secondes)
  useTick();

  useEffect(() => {
    go("info").then((j) => j && setInfo({ at: j.shutdown_at || null, awake: j.awake_until || null }));
  }, []);

  const plan = async (m, label) => {
    const j = await go("schedule", { body: { minutes: m }, ok: "Extinction dans " + label });
    if (j) setInfo((i) => ({ ...i, at: j.shutdown_at }));
  };

  const cancel = async () => {
    const j = await go("cancel", { ok: "Extinction annulée" });
    if (j) setInfo((i) => ({ ...i, at: null }));
  };

  const stay = async (m, label) => {
    const j = await go("awake", { body: { minutes: m }, ok: m ? "PC éveillé pendant " + label : "Veille autorisée" });
    if (j) setInfo((i) => ({ ...i, awake: j.awake_until || null }));
  };

  const left = (t) => (t ? Math.max(0, Math.round((t * 1000 - Date.now()) / 60000)) : 0);

  return (
    <Sheet title="Minuteries" onClose={close}>
      {() => (
        <>
          {info.at && (
            <>
              <div className="cap">Extinction prévue</div>
              <div className="list">
                <Row flat label={"À " + hhmm(info.at)} detail={"dans " + dur(left(info.at))} />
                <Row flat accent label="Annuler l'extinction" onClick={cancel} />
              </div>
            </>
          )}
          <div className="cap">{info.at ? "Changer : éteindre dans…" : "Éteindre dans…"}</div>
          <div className="list">
            {PRESETS.map(([m, label]) => (
              <Row key={m} flat label={label} onClick={() => plan(m, label)} />
            ))}
          </div>

          {info.awake && (
            <>
              <div className="cap">Veille bloquée</div>
              <div className="list">
                <Row flat label={"Éveillé jusqu'à " + hhmm(info.awake)} detail={"dans " + dur(left(info.awake))} />
                <Row flat accent label="Autoriser la veille" onClick={() => stay(0)} />
              </div>
            </>
          )}
          <div className="cap">Garder le PC éveillé</div>
          <div className="list">
            {STAY.map(([m, label]) => (
              <Row key={m} flat label={label} onClick={() => stay(m, label)} />
            ))}
          </div>
          <p className="foot">Le PC ne se met pas en veille tout seul pendant ce temps, par exemple pendant un téléchargement. L'écran peut s'éteindre.</p>

          <div className="cap">Allumer</div>
          <div className="list">
            <Row icon="clock" color="var(--orange)" label="Réveil programmé" chevron onClick={openWake} />
          </div>
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

// ---------------------------------------------------------------- Envoyer au PC : applis, sites, téléchargements
export function SendSheet({ go, close }) {
  const [apps, setApps] = useState(null);
  const [url, setUrl] = useState("");
  const [dlUrl, setDlUrl] = useState("");
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    go("apps").then((j) => setApps(j ? j.apps : []));
  }, []);

  // Suivi des téléchargements du PC
  const poll = async () => {
    const j = await go("dl_status", { quiet: true });
    if (j) setJobs(j.jobs);
  };

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, []);

  const openUrl = () => {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    go("url", { body: { url: u }, ok: "Site ouvert sur le PC" });
  };

  const startDl = async () => {
    let u = dlUrl.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const j = await go("dl_start", { body: { url: u }, ok: "Téléchargement lancé sur le PC" });
    if (j) {
      setDlUrl("");
      poll();
    }
  };

  const state = (j) =>
    j.state === "run" ? (j.total ? Math.round((100 * j.got) / j.total) + " %" : fmtSize(j.got)) : j.state === "ok" ? "Terminé · " + fmtSize(j.total) : j.error;

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

          <div className="cap">Ouvrir un site sur le PC</div>
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

          <div className="cap">Télécharger sur le PC</div>
          <div className="list">
            <label className="field left">
              <input
                type="text"
                inputMode="url"
                value={dlUrl}
                onChange={(e) => setDlUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startDl()}
                placeholder="Lien du fichier"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button className="mini" disabled={!dlUrl.trim()} onClick={startDl}>
                Lancer
              </button>
            </label>
          </div>
          {jobs.length > 0 && (
            <div className="list">
              {jobs.map((j) => (
                <Row
                  key={j.id}
                  flat
                  danger={j.state === "err"}
                  label={j.name}
                  detail={state(j)}
                  onClick={j.state === "run" ? () => go("dl_cancel", { body: { id: j.id }, ok: "Téléchargement annulé" }) : undefined}
                />
              ))}
            </div>
          )}
          <p className="foot">
            Le PC télécharge le fichier dans son dossier partagé : tu le retrouves ensuite dans Fichiers. Appuie sur un téléchargement en cours pour
            l'annuler.
          </p>
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
