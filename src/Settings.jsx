import Sheet from "./Sheet";
import { save } from "./api";

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

export default function Settings({ cfg, setCfg, close }) {
  const set = (key) => (e) => {
    const next = { ...cfg, [key]: e.target.value.trim() };
    setCfg(next);
    save(next);
  };

  return (
    <Sheet title="Connexion" onClose={close}>
      {({ dismiss }) => (
        <>
          <div className="cap">Ordinateur</div>
          <div className="list">
            <Field label="Adresse" value={cfg.pcUrl} onChange={set("pcUrl")} placeholder="https://mon-pc.xxx.ts.net" />
            <Field label="Token" type="password" value={cfg.pcToken} onChange={set("pcToken")} placeholder="Obligatoire" />
          </div>
          <p className="foot">
            L'adresse s'affiche quand tu lances tailscale serve sur le PC. Le token est le mot de passe que tu as mis dans TOKEN.
          </p>

          <div className="cap">Relais d'allumage</div>
          <div className="list">
            <Field label="Adresse" value={cfg.relayUrl} onChange={set("relayUrl")} placeholder="https://mon-relais.xxx.ts.net" />
            <Field label="Token" type="password" value={cfg.relayToken} onChange={set("relayToken")} placeholder="Différent du PC" />
          </div>
          <p className="foot">Même principe, mais avec l'adresse et le token du relais. Tout reste sur cet appareil.</p>

          <button className="big" onClick={dismiss}>
            Terminé
          </button>
        </>
      )}
    </Sheet>
  );
}
