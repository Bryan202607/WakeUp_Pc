import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import Icon from "./icons";
import { shotUrl, openExternal } from "./api";
import { copyText, buzz } from "./util";

// ---------------------------------------------------------------- Souris et clavier
const SPEEDS = [0.9, 1.5, 2.2, 3.2]; // vitesse du curseur (1 à 4)

const KEYPAD = [
  ["Entrée", { key: "enter" }],
  ["Retour", { key: "backspace" }],
  ["Suppr", { key: "delete" }],
  ["Tab", { key: "tab" }],
  ["Échap", { key: "esc" }],
  ["Début", { key: "home" }],
  ["←", { key: "left" }],
  ["↑", { key: "up" }],
  ["↓", { key: "down" }],
  ["→", { key: "right" }],
  ["Fin", { key: "end" }],
  ["Win", { key: "win" }],
];

const COMBOS = [
  ["Copier", ["ctrl", "c"]],
  ["Coller", ["ctrl", "v"]],
  ["Annuler", ["ctrl", "z"]],
  ["Tout", ["ctrl", "a"]],
  ["Alt+Tab", ["alt", "tab"]],
  ["Bureau", ["win", "d"]],
  ["Fermer l'onglet", ["ctrl", "w"]],
  ["Actualiser", ["f5"]],
];

export function TouchpadSheet({ go, close }) {
  const [speed, setSpeed] = useState(() => {
    try {
      return Number(localStorage.getItem("pcr_speed")) || 2;
    } catch (e) {
      return 2;
    }
  });
  const [held, setHeld] = useState(false);
  const [text, setText] = useState("");

  const acc = useRef({ dx: 0, dy: 0, sc: 0 });
  const busy = useRef(false);
  const pointers = useRef(new Map());
  const g = useRef({ moved: 0, start: 0, most: 0 });
  const speedRef = useRef(speed);
  const heldRef = useRef(false);
  const prev = useRef("");
  const queue = useRef(Promise.resolve());

  speedRef.current = speed;
  heldRef.current = held;

  // Envoie les mouvements accumulés toutes les 40 ms (jamais deux envois en même temps)
  useEffect(() => {
    const flush = async () => {
      if (busy.current) return;
      const a = acc.current;
      const dx = Math.trunc(a.dx);
      const dy = Math.trunc(a.dy);
      const sc = Math.trunc(a.sc);
      if (!dx && !dy && !sc) return;
      a.dx -= dx;
      a.dy -= dy;
      a.sc -= sc;
      busy.current = true;
      await go("mouse", { body: { dx, dy, scroll: sc }, quiet: true });
      busy.current = false;
    };
    const id = setInterval(flush, 40);
    return () => {
      clearInterval(id);
      if (heldRef.current) go("mouse", { body: { btn: "left", act: "up" }, quiet: true }); // on relâche le bouton en partant
    };
  }, []);

  const click = (btn, act) => {
    buzz(6);
    go("mouse", { body: { btn, act: act || "click" }, quiet: true });
  };

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) g.current = { moved: 0, start: Date.now(), most: 1 };
    g.current.most = Math.max(g.current.most, pointers.current.size);
  };

  const move = (e) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    g.current.moved += Math.abs(dx) + Math.abs(dy);
    const n = pointers.current.size;
    if (n === 1) {
      acc.current.dx += dx * SPEEDS[speedRef.current - 1];
      acc.current.dy += dy * SPEEDS[speedRef.current - 1];
    } else {
      acc.current.sc += -dy / n / 22; // deux doigts : défilement, comme sur un téléphone
    }
  };

  const up = (e) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) {
      const { moved, start, most } = g.current;
      if (Date.now() - start < 260 && moved < 10) click(most >= 2 ? "right" : "left"); // un tap clique, deux doigts = clic droit
    }
  };

  const toggleHold = () => {
    const next = !held;
    setHeld(next);
    buzz(8);
    go("mouse", { body: { btn: "left", act: next ? "down" : "up" }, quiet: true });
  };

  // Frappe en direct : on envoie seulement ce qui change dans le champ
  const typeQ = (body) => {
    queue.current = queue.current.then(() => go("key", { body, quiet: true }));
  };

  const onType = (e) => {
    const v = e.target.value;
    const p = prev.current;
    let i = 0;
    while (i < v.length && i < p.length && v[i] === p[i]) i++;
    const del = p.length - i;
    const add = v.slice(i);
    if (del) typeQ({ key: "backspace", n: del });
    if (add) typeQ({ text: add });
    if (v.length > 200) {
      prev.current = "";
      setText("");
    } else {
      prev.current = v;
      setText(v);
    }
  };

  const sendKey = (body) => {
    buzz(6);
    typeQ(body);
    if (body.key === "enter") {
      prev.current = "";
      setText("");
    }
  };

  return (
    <Sheet title="Souris et clavier" onClose={close}>
      {() => (
        <>
          <div className="tpad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <Icon name="pointer" size={28} />
            <span>Glisse pour déplacer. Touche pour cliquer. Deux doigts pour défiler ou faire un clic droit.</span>
          </div>

          <div className="gbar tbtns">
            <button className="mini soft" onClick={() => click("left")}>
              Clic gauche
            </button>
            <button className="mini soft" onClick={() => click("right")}>
              Clic droit
            </button>
            <button className={"mini" + (held ? "" : " soft")} onClick={toggleHold}>
              {held ? "Lâcher" : "Glisser"}
            </button>
          </div>

          <div className="list">
            <label className="field">
              <span>Vitesse</span>
              <input
                type="range"
                min="1"
                max="4"
                step="1"
                value={speed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSpeed(v);
                  try {
                    localStorage.setItem("pcr_speed", String(v));
                  } catch (err) {}
                }}
              />
            </label>
          </div>

          <div className="cap">Clavier</div>
          <div className="list">
            <label className="field left">
              <input
                type="text"
                value={text}
                onChange={onType}
                placeholder="Écris ici, ça s'écrit sur le PC"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="kgrid">
            {KEYPAD.map(([label, body]) => (
              <button key={label} className="kbtn" onClick={() => sendKey(body)}>
                {label}
              </button>
            ))}
          </div>
          <div className="kgrid">
            {COMBOS.map(([label, combo]) => (
              <button key={label} className="kbtn alt" onClick={() => sendKey({ combo })}>
                {label}
              </button>
            ))}
          </div>
          <p className="foot center">Ça agit sur le vrai PC : utilise-le seulement quand tu en as besoin.</p>
        </>
      )}
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
