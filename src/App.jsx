import { useRef, useState } from "react";
import { call, load } from "./api";
import useStatus from "./useStatus";
import Settings from "./Settings";
import Icon from "./icons";

const ACTIONS = [
  { id: "lock", label: "Verrouiller", icon: "lock", color: "var(--blue)" },
  { id: "sleep", label: "Mettre en veille", icon: "moon", color: "var(--indigo)" },
  { id: "restart", label: "Redémarrer", icon: "restart", color: "var(--orange)", danger: true },
  { id: "shutdown", label: "Éteindre", icon: "power", color: "var(--red)", danger: true },
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

export default function App() {
  const [cfg, setCfg] = useState(load);
  const [showSettings, setShowSettings] = useState(false);
  const [armed, setArmed] = useState(null);
  const [toast, setToast] = useState(null);
  const armTimer = useRef(null);
  const toastTimer = useRef(null);

  const pc = useStatus(cfg.pcUrl, cfg.pcToken);
  const relay = useStatus(cfg.relayUrl, cfg.relayToken);
  const configured = Boolean(cfg.pcUrl && cfg.pcToken);

  const say = (text, kind = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ text, kind, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const run = async (url, token, id, okText) => {
    try {
      await call(url, token, id);
      buzz(12);
      say(okText);
    } catch (e) {
      buzz([12, 50, 12]);
      say(e.message === "Failed to fetch" ? "Injoignable. Tailscale est-il actif ?" : e.message, "error");
    }
  };

  const tap = (action) => {
    const send = () => run(cfg.pcUrl, cfg.pcToken, action.id, action.label + " : envoyé");
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
            <p className="sub">Ton ordinateur, à distance</p>
          </div>
          <button className="icon-btn" aria-label="Réglages" onClick={() => setShowSettings(true)}>
            <Icon name="sliders" />
          </button>
        </header>

        {!configured ? (
          <section className="group empty appear">
            <h2>Bienvenue</h2>
            <p>Ajoute l'adresse et le token de ton ordinateur pour commencer.</p>
            <button className="big" onClick={() => setShowSettings(true)}>
              Configurer
            </button>
          </section>
        ) : (
          <>
            <div className="pill">
              <span className={"dot " + dotClass}></span>
              {LABELS[pc]}
            </div>

            {pc === "on" ? (
              <section className="group appear">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    className={"row" + (armed === a.id ? " armed" : "")}
                    onClick={() => tap(a)}
                  >
                    <span className="chip" style={{ background: a.color }}>
                      <Icon name={a.icon} size={20} />
                    </span>
                    <span className={"label" + (a.danger && armed !== a.id ? " danger" : "")}>
                      {armed === a.id ? "Appuie pour confirmer" : a.label}
                    </span>
                    {armed === a.id && <small>4 s</small>}
                  </button>
                ))}
              </section>
            ) : (
              <div className="appear">
                <button
                  className="wake"
                  disabled={relay !== "on" || pc === "denied"}
                  onClick={() => run(cfg.relayUrl, cfg.relayToken, "wake", "Allumage envoyé")}
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

      {showSettings && <Settings cfg={cfg} setCfg={setCfg} close={() => setShowSettings(false)} />}
      {toast && (
        <div key={toast.id} className={"toast " + toast.kind} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
