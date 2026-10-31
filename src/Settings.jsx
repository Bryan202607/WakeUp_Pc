import Sheet from "./Sheet";
import Row from "./Row";
import { save } from "./api";
import { hasPin } from "./pin";

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value || ""}
        onChange={onChange}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </label>
  );
}

export default function Settings({ cfg, setCfg, close, openPin, openGuide }) {
  const persist = (next) => {
    setCfg(next);
    save(next);
  };
  const set = (key) => (e) => persist({ ...cfg, [key]: e.target.value.trim() });

  return (
    <Sheet title="Réglages" onClose={close}>
      {({ dismiss }) => (
        <>
          <div className="cap">Ordinateur</div>
          <div className="list">
            <Field label="Adresse" value={cfg.pcUrl} onChange={set("pcUrl")} placeholder="https://mon-pc.xxx.ts.net" />
            <Field label="Token" type="password" value={cfg.pcToken} onChange={set("pcToken")} placeholder="Obligatoire" />
            <Field label="Direct" value={cfg.lanPcUrl} onChange={set("lanPcUrl")} placeholder="192.168.43.2 (sans internet)" />
          </div>
          <p className="foot">
            L'adresse s'affiche quand tu lances tailscale serve sur le PC. Le token est le mot de passe que tu as mis dans TOKEN.
            « Direct » sert à travailler sans internet : c'est l'adresse locale que l'agent affiche quand il est lancé avec LAN=1.
          </p>

          <div className="cap">Relais d'allumage</div>
          <div className="list">
            <Field label="Adresse" value={cfg.relayUrl} onChange={set("relayUrl")} placeholder="https://mon-relais.xxx.ts.net" />
            <Field label="Token" type="password" value={cfg.relayToken} onChange={set("relayToken")} placeholder="Différent du PC" />
            <Field label="Direct" value={cfg.lanRelayUrl} onChange={set("lanRelayUrl")} placeholder="192.168.1.20 (sans internet)" />
          </div>
          <p className="foot">Même principe, mais avec l'adresse et le token du relais. Tout reste sur cet appareil.</p>

          <div className="cap">Sécurité</div>
          <div className="list">
            <Row icon="shield" color="var(--blue)" label="Code PIN" detail={hasPin() ? "Activé" : "Désactivé"} chevron onClick={openPin} />
          </div>

          <div className="cap">Aide</div>
          <div className="list">
            <Row icon="book" color="var(--teal)" label="Guide d'utilisation" chevron onClick={openGuide} />
          </div>

          <div className="cap">Démonstration</div>
          <div className="list">
            <div className="field sw">
              <span>Mode démo</span>
              <button
                role="switch"
                aria-checked={Boolean(cfg.demo)}
                aria-label="Mode démo"
                className={"switch" + (cfg.demo ? " on" : "")}
                onClick={() => persist({ ...cfg, demo: !cfg.demo })}
              />
            </div>
          </div>
          <p className="foot">Essaie l'appli avec un faux ordinateur. Rien n'est envoyé, tes réglages ne changent pas.</p>

          <button className="big" onClick={dismiss}>
            Terminé
          </button>
        </>
      )}
    </Sheet>
  );
}
