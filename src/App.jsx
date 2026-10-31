import { useEffect, useRef, useState } from "react";
import { call, load, save, isNative, normLan } from "./api";
import { hasPin } from "./pin";
import useStatus from "./useStatus";
import Settings from "./Settings";
import Guide from "./Guide";
import { FilesSheet } from "./Files";
import Row from "./Row";
import Icon from "./icons";
import { Lock, PinSheet } from "./Pin";
import { TimerSheet, OtherSheet, MediaSheet, SendSheet, InfoSheet } from "./Tools";

const GRACE = 30000; // l'appli se reverrouille après 30 s en arrière-plan

// Écran principal : les 4 actions de base
const ACTIONS = [
  { id: "lock", label: "Verrouiller", icon: "lock", color: "var(--blue)" },
  { id: "sleep", label: "Mettre en veille", icon: "moon", color: "var(--indigo)" },
  { id: "restart", label: "Redémarrer", icon: "restart", color: "var(--orange)", danger: true },
  { id: "shutdown", label: "Éteindre", icon: "power", color: "var(--red)", danger: true },
];

// Rangées de l'écran "Autres actions"
const EXTRA = [
  { id: "hibernate", label: "Hiberner", icon: "snow", color: "var(--indigo)" },
  { id: "logout", label: "Se déconnecter", icon: "logout", color: "var(--orange)", danger: true },
  { id: "screenoff", label: "Éteindre l'écran", icon: "monitor", color: "var(--secondary)" },
];

// Rangées qui ouvrent une feuille
const TOOLS = [
  { id: "files", label: "Fichiers", icon: "folder", color: "var(--blue)" },
  { id: "timer", label: "Éteindre dans…", icon: "clock", color: "var(--orange)" },
  { id: "other", label: "Autres actions", icon: "dots", color: "var(--secondary)" },
  { id: "media", label: "Médias et volume", icon: "music", color: "var(--pink)" },
  { id: "send", label: "Envoyer au PC", icon: "send", color: "var(--indigo)" },
  { id: "info", label: "Infos et historique", icon: "info", color: "var(--teal)" },
];

const LABELS = {
  none: "Non configuré",
  check: "Vérification…",
  on: "Ordinateur en ligne",
  off: "Ordinateur hors ligne",
  denied: "Accès refusé",
};

const buzz = (pattern) => {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {}
};

// Fusionne l'état de deux routes vers le même appareil
const merge = (a, b) => {
  if (a === "on" || b === "on") return "on";
  for (const s of ["check", "denied", "off"]) if (a === s || b === s) return s;
  return "none";
};

export default function App() {
  const [cfg, setCfg] = useState(load);
  const [view, setView] = useState(null); // feuille ouverte : settings, guide, pin, timer, other, media, send, info
  const [locked, setLocked] = useState(hasPin);
  const [armed, setArmed] = useState(null);
  const [toast, setToast] = useState(null);
  const armTimer = useRef(null);
  const toastTimer = useRef(null);

  // Mode démo : faux ordinateur et faux relais, la vraie config n'est pas touchée
  const demo = Boolean(cfg.demo);
  const pcToken = demo ? "pc" : cfg.pcToken;
  const relayToken = demo ? "relay" : cfg.relayToken;

  // Deux routes vers chaque appareil : Tailscale (internet) et connexion directe (réseau local).
  // La connexion directe n'existe que dans l'appli Android.
  const direct = !demo && isNative();
  const pcTs = demo ? "demo" : cfg.pcUrl;
  const pcLan = direct ? normLan(cfg.lanPcUrl) : "";
  const relayTs = demo ? "demo" : cfg.relayUrl;
  const relayLan = direct ? normLan(cfg.lanRelayUrl) : "";

  // Pas de vérification réseau tant que l'appli est verrouillée
  const pcTsState = useStatus(locked ? "" : pcTs, pcToken);
  const pcLanState = useStatus(locked ? "" : pcLan, pcToken);
  const relayTsState = useStatus(locked ? "" : relayTs, relayToken);
  const relayLanState = useStatus(locked ? "" : relayLan, relayToken);

  const pc = merge(pcTsState, pcLanState);
  const relay = merge(relayTsState, relayLanState);

  // La route directe passe avant : plus rapide et sans internet
  const pcRoute = pcLanState === "on" ? { base: pcLan, token: pcToken } : { base: pcTs, token: pcToken };
  const relayRoute = relayLanState === "on" ? { base: relayLan, token: relayToken } : { base: relayTs, token: relayToken };
  const viaLan = pc === "on" && pcLanState === "on";

  const configured = demo || Boolean((cfg.pcUrl || cfg.lanPcUrl) && cfg.pcToken);

  // Reverrouillage quand on quitte l'appli plus de 30 secondes
  useEffect(() => {
    let left = 0;
    const onVis = () => {
      if (document.hidden) left = Date.now();
      else if (left && hasPin() && Date.now() - left > GRACE) setLocked(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const say = (text, kind = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ text, kind, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  // Envoie une action au PC (ou au relais avec wake: true). Renvoie la réponse, ou null en cas d'erreur.
  const go = async (id, { body, ok, wake } = {}) => {
    const route = wake ? relayRoute : pcRoute;
    try {
      const j = await call(route.base, route.token, id, body);
      buzz(12);
      if (ok) say(ok);
      return j;
    } catch (e) {
      buzz([12, 50, 12]);
      say(
        e.message === "Failed to fetch"
          ? "Injoignable. Tailscale ou la connexion directe est-il actif ?"
          : e.message === "signature invalide"
          ? "Token refusé : vérifie qu'il est identique à celui de l'agent"
          : e.message,
        "error"
      );
      return null;
    }
  };

  // Les actions dangereuses demandent un deuxième appui pour confirmer
  const tap = (action) => {
    const send = () => go(action.id, { ok: action.label + " : envoyé" });
    if (!action.danger) return send();

    if (armed === action.id) {
      clearTimeout(armTimer.current);
      setArmed(null);
      return send();
    }
    buzz(8);
    setArmed(action.id);
    clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(null), 4000);
  };

  if (locked) return <Lock onUnlock={() => setLocked(false)} />;

  const close = () => setView(null);
  const dotClass = pc === "on" ? "on" : pc === "off" ? "off" : pc === "denied" ? "denied" : "";

  const relayNote =
    relay === "none"
      ? "Ajoute le relais dans les réglages pour pouvoir allumer le PC."
      : relay === "off"
      ? "Le relais est hors ligne."
      : relay === "denied"
      ? "Le token du relais est refusé."
      : "";

  return (
    <>
      <main className="wrap">
        <header className="top">
          <div>
            <h1 className="title">WakeUp-Pc</h1>
            <p className="sub">{demo ? "Mode démonstration" : "Ton ordinateur, à distance"}</p>
          </div>
          <div className="top-btns">
            <button className="icon-btn" aria-label="Guide d'utilisation" onClick={() => setView("guide")}>
              <Icon name="book" />
            </button>
            <button className="icon-btn" aria-label="Réglages" onClick={() => setView("settings")}>
              <Icon name="sliders" />
            </button>
          </div>
        </header>

        {!configured ? (
          <section className="group empty appear">
            <h2>Bienvenue</h2>
            <p>Ajoute l'adresse et le token de ton ordinateur pour commencer.</p>
            <button className="big" onClick={() => setView("settings")}>
              Configurer
            </button>
            <button className="ghost" onClick={() => setView("guide")}>
              Lire le guide
            </button>
            <button
              className="ghost"
              onClick={() => {
                const next = { ...cfg, demo: true };
                setCfg(next);
                save(next);
              }}
            >
              Essayer en mode démo
            </button>
          </section>
        ) : (
          <>
            <div className="pill">
              <span className={"dot " + dotClass}></span>
              {LABELS[pc]}{viaLan ? " · direct" : ""}
            </div>

            {pc === "on" ? (
              <div className="appear">
                <section className="group">
                  {ACTIONS.map((a) => (
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
                </section>
                <section className="group">
                  {TOOLS.map((t) => (
                    <Row key={t.id} icon={t.icon} color={t.color} label={t.label} chevron onClick={() => setView(t.id)} />
                  ))}
                </section>
              </div>
            ) : (
              <div className="appear">
                <button
                  className="wake"
                  disabled={relay !== "on" || pc === "denied"}
                  onClick={() => go("wake", { wake: true, ok: "Allumage envoyé" })}
                >
                  <Icon name="bolt" size={22} />
                  Allumer l'ordinateur
                </button>
                {relayNote && <p className="note">{relayNote}</p>}
              </div>
            )}
          </>
        )}
      </main>

      {view === "settings" && (
        <Settings cfg={cfg} setCfg={setCfg} close={close} openPin={() => setView("pin")} openGuide={() => setView("guide")} />
      )}
      {view === "guide" && <Guide close={close} />}
      {view === "pin" && <PinSheet say={say} close={close} />}
      {view === "files" && <FilesSheet route={pcRoute} go={go} say={say} close={close} />}
      {view === "timer" && <TimerSheet go={go} close={close} />}
      {view === "other" && <OtherSheet actions={EXTRA} tap={tap} armed={armed} close={close} />}
      {view === "media" && <MediaSheet go={go} close={close} />}
      {view === "send" && <SendSheet go={go} close={close} />}
      {view === "info" && <InfoSheet go={go} close={close} />}

      {toast && (
        <div key={toast.id} className={"toast " + toast.kind} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
