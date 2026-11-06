import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import Icon from "./icons";
import { shotUrl, openExternal } from "./api";
import { copyText, buzz } from "./util";

// ---------------------------------------------------------------- Déverrouiller le PC
export function UnlockSheet({ go, close }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Sheet title="Déverrouiller le PC" onClose={close}>
      {({ dismiss }) => {
        const submit = async () => {
          setBusy(true);
          const j = await go("unlock", { body: { code }, ok: "PC déverrouillé" });
          setBusy(false);
          if (j) {
            setCode("");
            dismiss();
          }
        };
        return (
          <>
            <p className="foot center">
              Entre le code de déverrouillage choisi à l'installation (ce n'est pas le mot de passe Windows). Ça prend une dizaine de secondes.
            </p>
            <div className="list">
              <label className="field">
                <span>Code</span>
                <input
                  type="password"
                  value={code}
                  autoFocus
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && code && !busy && submit()}
                  placeholder="Code de déverrouillage"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
            </div>
            <button className="big" disabled={!code || busy} onClick={submit}>
              {busy ? "Déverrouillage…" : "Déverrouiller"}
            </button>
            <p className="foot">Pas encore installé ? Regarde le chapitre « Déverrouiller le PC » du guide.</p>
          </>
        );
      }}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Capture d'écran
const WIDTHS = [
  ["Léger", 800],
  ["Normal", 1280],
  ["Net", 1920],
];

export function ScreenSheet({ route, say, close }) {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  const [live, setLive] = useState(false);
  const [w, setW] = useState(1280);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const liveRef = useRef(false);
  const wRef = useRef(1280);
  liveRef.current = live;
  wRef.current = w;

  const load = async (isLive) => {
    setBusy(true);
    setErr("");
    try {
      setSrc(await shotUrl(route.base, route.token, { w: wRef.current, ...(isLive ? { live: 1 } : {}) }));
    } catch (e) {
      setBusy(false);
      setErr("Injoignable. Tailscale ou la connexion directe est-il actif ?");
      setLive(false);
    }
  };

  useEffect(() => {
    load(false);
    return () => {
      alive.current = false;
    };
  }, []);

  const onLoad = () => {
    setBusy(false);
    if (liveRef.current && alive.current) setTimeout(() => liveRef.current && alive.current && load(true), 2500);
  };

  const onError = () => {
    setBusy(false);
    setLive(false);
    setErr("Capture impossible. L'écran est peut-être verrouillé, ou l'agent n'est pas à jour.");
  };

  const toggleLive = () => {
    const next = !live;
    setLive(next);
    liveRef.current = next;
    if (next) load(true);
  };

  const save = async () => {
    try {
      await openExternal(await shotUrl(route.base, route.token, { w: wRef.current, save: 1 }));
      say(route.base === "demo" ? "Démo : l'image serait enregistrée" : "Enregistrement lancé");
    } catch (e) {
      say("Injoignable.", "error");
    }
  };

  return (
    <Sheet title="Capture d'écran" onClose={close}>
      {() => (
        <>
          <div className="shot">
            {src && !err ? <img src={src} alt="Écran du PC" onLoad={onLoad} onError={onError} /> : <div className="shot-empty">{err || "Chargement…"}</div>}
          </div>
          {err && src && <p className="foot center">{err}</p>}

          <div className="gbar tbtns">
            <button className="mini" disabled={busy} onClick={() => load(false)}>
              Actualiser
            </button>
            <button className="mini soft" onClick={save}>
              Enregistrer
            </button>
            {WIDTHS.map(([label, px]) => (
              <button
                key={px}
                className={"mini" + (w === px ? "" : " soft")}
                onClick={() => {
                  setW(px);
                  wRef.current = px;
                  load(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="list">
            <div className="field sw">
              <span>Affichage en direct</span>
              <button role="switch" aria-checked={live} aria-label="Affichage en direct" className={"switch" + (live ? " on" : "")} onClick={toggleLive} />
            </div>
          </div>
          <p className="foot">Une nouvelle image toutes les 3 secondes environ. Réglage Léger pour économiser la connexion.</p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Presse-papiers (dans les deux sens)
export function ClipboardSheet({ go, say, close }) {
  const [text, setText] = useState("");
  const [pcText, setPcText] = useState(null);

  const toPc = async () => {
    const j = await go("clip", { body: { text }, ok: "Copié sur le PC : fais Ctrl+V" });
    if (j) setText("");
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t.slice(0, 2000));
      else say("Le presse-papiers du téléphone est vide");
    } catch (e) {
      say("Colle avec un appui long dans la zone de texte");
    }
  };

  const fromPc = async () => {
    const j = await go("clipget");
    if (j) setPcText(j.text || "");
  };

  const toPhone = async () => {
    say((await copyText(pcText)) ? "Copié sur le téléphone" : "Copie impossible", pcText ? "ok" : "error");
  };

  return (
    <Sheet title="Presse-papiers" onClose={close}>
      {() => (
        <>
          <div className="cap">Du téléphone vers le PC</div>
          <div className="list">
            <textarea className="area" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Écris ou colle un texte" />
          </div>
          <div className="gbar">
            <button className="mini soft" onClick={paste}>
              Coller
            </button>
            <button className="mini" disabled={!text} onClick={toPc}>
              Copier sur le PC
            </button>
          </div>

          <div className="cap">Du PC vers le téléphone</div>
          <div className="gbar">
            <button className="mini" onClick={fromPc}>
              Lire le presse-papiers du PC
            </button>
          </div>
          {pcText !== null && (
            <>
              <pre className="gcode">{pcText || "(vide)"}</pre>
              <div className="gbar">
                <button className="mini soft" disabled={!pcText} onClick={toPhone}>
                  Copier sur le téléphone
                </button>
              </div>
            </>
          )}
          <p className="foot">Sur le PC, copie d'abord un texte (Ctrl+C), puis appuie sur « Lire ».</p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Programmes en cours
const mem = (kb) => (kb >= 1048576 ? (kb / 1048576).toFixed(1) + " Go" : Math.round(kb / 1024) + " Mo");

export function ProcsSheet({ go, close }) {
  const [list, setList] = useState(undefined); // undefined = chargement, null = échec
  const [armed, setArmed] = useState(null);
  const timer = useRef(null);

  const load = async () => {
    const j = await go("procs");
    setList(j ? j.procs : null);
  };

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, []);

  const tap = async (p) => {
    if (armed === p.n) {
      clearTimeout(timer.current);
      setArmed(null);
      await go("kill", { body: { name: p.n }, ok: p.n + " : fermé" });
      load();
      return;
    }
    buzz(8);
    setArmed(p.n);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(null), 4000);
  };

  return (
    <Sheet title="Programmes en cours" onClose={close}>
      {() => (
        <>
          <div className="list">
            <Row flat accent label="Actualiser" onClick={load} />
          </div>
          {list === undefined && <p className="foot center">Chargement…</p>}
          {list === null && <p className="foot center">Impossible de lire la liste.</p>}
          {list && (
            <>
              <div className="cap">Les plus gourmands en mémoire</div>
              <div className="list">
                {list.map((p) => (
                  <Row
                    key={p.n}
                    flat
                    danger={!p.p}
                    armed={armed === p.n}
                    label={p.n.replace(/\.exe$/i, "") + (p.c > 1 ? "  ×" + p.c : "")}
                    detail={p.p ? "protégé" : mem(p.m)}
                    onClick={p.p ? undefined : () => tap(p)}
                  />
                ))}
              </div>
              <p className="foot">Appuie deux fois sur un programme pour le fermer, avec toutes ses fenêtres. Ce qui n'est pas enregistré est perdu.</p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Raccourcis personnalisés
export function ShortcutsSheet({ go, close }) {
  const [list, setList] = useState(undefined);
  const [armed, setArmed] = useState(null);
  const [out, setOut] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    go("shortcuts").then((j) => setList(j ? j.shortcuts : null));
    return () => clearTimeout(timer.current);
  }, []);

  const run = async (s) => {
    setOut(null);
    const j = await go("run", { body: { name: s.n }, ok: s.n + " : lancé" });
    if (j && j.output !== undefined) setOut({ name: s.n, text: j.output, code: j.code });
  };

  const tap = (s) => {
    if (!s.confirm) return run(s);
    if (armed === s.n) {
      clearTimeout(timer.current);
      setArmed(null);
      return run(s);
    }
    buzz(8);
    setArmed(s.n);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(null), 4000);
  };

  return (
    <Sheet title="Raccourcis" onClose={close}>
      {() => (
        <>
          {list === undefined && <p className="foot center">Chargement…</p>}
          {list === null && <p className="foot center">Impossible de lire la liste.</p>}
          {list && list.length === 0 && (
            <p className="foot center">Aucun raccourci. Crée un fichier shortcuts.json à côté de agent.py (voir le guide).</p>
          )}
          {list && list.length > 0 && (
            <div className="list">
              {list.map((s) => (
                <Row key={s.n} icon="terminal" color="var(--indigo)" label={s.n} armed={armed === s.n} danger={s.confirm} onClick={() => tap(s)} />
              ))}
            </div>
          )}
          {out && (
            <>
              <div className="cap">Résultat de « {out.name} »</div>
              <pre className="gcode">{out.text.trim() || "(rien à afficher)"}</pre>
              {out.code !== 0 && <p className="foot">Code de sortie : {out.code}</p>}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Réveil programmé (sur le relais)
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const daysText = (d) => {
  if (!d || d.length === 0) return "Une fois";
  if (d.length === 7) return "Tous les jours";
  if (d.join() === "0,1,2,3,4") return "En semaine";
  if (d.join() === "5,6") return "Le week-end";
  return d.map((i) => DAYS[i]).join(", ");
};

export function WakeSheet({ go, close }) {
  const [data, setData] = useState(undefined); // undefined = chargement, null = relais injoignable
  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState([0, 1, 2, 3, 4]);

  const load = async () => {
    const j = await go("schedule_list", { wake: true });
    setData(j || null);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const j = await go("schedule_add", { wake: true, body: { time, days }, ok: "Réveil programmé" });
    if (j) load();
  };

  const toggle = async (it) => {
    await go("schedule_toggle", { wake: true, body: { id: it.id, on: !it.on } });
    load();
  };

  const del = async (it) => {
    await go("schedule_del", { wake: true, body: { id: it.id } });
    load();
  };

  const flip = (i) => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));

  return (
    <Sheet title="Réveil programmé" onClose={close}>
      {() => (
        <>
          {data === undefined && <p className="foot center">Chargement…</p>}
          {data === null && (
            <p className="foot center">Le relais ne répond pas. Il faut qu'il soit allumé et connecté pour envoyer le signal à l'heure choisie.</p>
          )}
          {data && (
            <>
              {data.items.length > 0 && (
                <>
                  <div className="cap">Réveils</div>
                  <div className="list">
                    {data.items.map((it) => (
                      <div className="field sw" key={it.id}>
                        <span>
                          <b>{it.time}</b> · {daysText(it.days)}
                        </span>
                        <button role="switch" aria-checked={it.on} aria-label="Activer" className={"switch" + (it.on ? " on" : "")} onClick={() => toggle(it)} />
                        <button className="iconx" aria-label="Supprimer" onClick={() => del(it)}>
                          <Icon name="xmark" size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="cap">Nouveau réveil</div>
              <div className="list">
                <label className="field">
                  <span>Heure</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </label>
              </div>
              <div className="daychips">
                {DAYS.map((d, i) => (
                  <button key={d} className={"daychip" + (days.includes(i) ? " on" : "")} onClick={() => flip(i)}>
                    {d}
                  </button>
                ))}
              </div>
              <button className="big" disabled={!time} onClick={add}>
                Ajouter le réveil
              </button>
              <p className="foot">
                Sans aucun jour coché, le réveil ne sonne qu'une fois. L'heure est celle du relais ({data.now} {data.tz}) : vérifie qu'elle est juste.
                Le relais doit rester allumé et le PC branché en câble.
              </p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
