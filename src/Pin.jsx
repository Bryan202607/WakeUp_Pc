import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import Icon from "./icons";
import { hasPin, setPin, checkPin, clearPin, wipeAll } from "./pin";
import { bioOn, setBioOn, bioAvailable, bioAsk } from "./bio";

const LEN = 6;

const buzz = (p) => {
  try {
    if (navigator.vibrate) navigator.vibrate(p);
  } catch (e) {}
};

// Clavier numérique avec 6 points. onDone(code) renvoie un texte d'erreur, ou rien si c'est bon.
export function PinPad({ title, hint, onDone }) {
  const [digits, setDigits] = useState("");
  const [msg, setMsg] = useState("");
  const [shake, setShake] = useState(false);
  const cur = useRef("");
  const busy = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  const put = (v) => {
    cur.current = v;
    setDigits(v);
  };

  const press = async (k) => {
    if (busy.current) return;
    if (k === "del") return put(cur.current.slice(0, -1));
    if (cur.current.length >= LEN) return;
    buzz(6);
    setMsg("");
    put(cur.current + k);
    if (cur.current.length < LEN) return;

    busy.current = true;
    let err;
    try {
      err = await done.current(cur.current);
    } catch (e) {
      err = e.message || "Erreur";
    }
    busy.current = false;
    if (err) {
      setMsg(err);
      setShake(true);
      buzz([12, 50, 12]);
      setTimeout(() => {
        setShake(false);
        put("");
      }, 450);
    } else {
      put("");
    }
  };

  // Clavier du téléphone ou de l'ordinateur
  useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pin">
      <h2 className="pin-title">{title}</h2>
      <p className={"pin-hint" + (msg ? " err" : "")}>{msg || hint || "\u00a0"}</p>
      <div className={"dots" + (shake ? " shake" : "")} aria-label={digits.length + " chiffres saisis"}>
        {Array.from({ length: LEN }, (_, i) => (
          <i key={i} className={i < digits.length ? "on" : ""} />
        ))}
      </div>
      <div className="keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button key={k} className="key" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <span />
        <button className="key" onClick={() => press("0")}>
          0
        </button>
        <button className="key quiet" aria-label="Effacer" onClick={() => press("del")}>
          <Icon name="backspace" size={26} />
        </button>
      </div>
    </div>
  );
}

// Écran affiché à l'ouverture de l'appli quand un code est activé
export function Lock({ onUnlock }) {
  const [sure, setSure] = useState(false);
  const withBio = bioOn();

  // L'empreinte s'ouvre toute seule. Le code reste toujours possible.
  const tryBio = async () => {
    if (await bioAsk()) onUnlock();
  };
  useEffect(() => {
    if (withBio) tryBio();
  }, []);

  const check = async (pin) => {
    const r = await checkPin(pin);
    if (r.ok) onUnlock();
    else return r.msg;
  };

  return (
    <main className="lock">
      <div className="lock-ic">
        <Icon name="lock" size={26} />
      </div>
      <PinPad title="WakeUp-Pc" hint="Entre ton code" onDone={check} />
      {withBio && (
        <button className="link bio" onClick={tryBio}>
          <Icon name="fingerprint" size={20} /> Utiliser l'empreinte
        </button>
      )}
      <button className={"link" + (sure ? " warn" : "")} onClick={() => (sure ? wipeAll() : setSure(true))}>
        {sure ? "Appuie encore : tout sera effacé sur cet appareil" : "Code oublié ?"}
      </button>
    </main>
  );
}

// Réglage du code : créer, changer, désactiver
export function PinSheet({ say, close }) {
  const [step, setStep] = useState("menu"); // menu | cur-change | cur-off | new | confirm
  const [note, setNote] = useState("");
  const [avail, setAvail] = useState(false); // le téléphone a une empreinte configurée
  const [, redraw] = useState(0);
  const first = useRef("");

  useEffect(() => {
    bioAvailable().then(setAvail);
  }, []);

  const toggleBio = async () => {
    if (bioOn()) {
      setBioOn(false);
      say("Empreinte désactivée");
    } else if (await bioAsk()) {
      setBioOn(true);
      say("Empreinte activée");
    } else {
      say("Empreinte non reconnue", "error");
    }
    redraw((n) => n + 1);
  };

  return (
    <Sheet title="Code PIN" onClose={close}>
      {({ dismiss }) => {
        let body;
        if (step === "menu") {
          body = hasPin() ? (
            <>
              <div className="list">
                <Row icon="shield" color="var(--blue)" label="Changer le code" chevron onClick={() => setStep("cur-change")} />
                <Row icon="xmark" color="var(--red)" label="Désactiver le code" onClick={() => setStep("cur-off")} />
              </div>
              {avail && (
                <div className="list">
                  <div className="field sw">
                    <span>Empreinte digitale</span>
                    <button
                      role="switch"
                      aria-checked={bioOn()}
                      aria-label="Empreinte digitale"
                      className={"switch" + (bioOn() ? " on" : "")}
                      onClick={toggleBio}
                    />
                  </div>
                </div>
              )}
              <p className="foot">L'appli se verrouille quand tu la quittes plus de 30 secondes. Avec l'empreinte, le code reste toujours possible.</p>
            </>
          ) : (
            <>
              <p className="foot center">
                Un code à 6 chiffres sera demandé à chaque ouverture de l'appli. Il reste sur ce téléphone.
              </p>
              <button className="big" onClick={() => setStep("new")}>
                Créer un code
              </button>
            </>
          );
        } else if (step === "cur-change" || step === "cur-off") {
          body = (
            <PinPad
              key={step}
              title="Code actuel"
              onDone={async (pin) => {
                const r = await checkPin(pin);
                if (!r.ok) return r.msg;
                if (step === "cur-off") {
                  clearPin();
                  setBioOn(false);
                  say("Code désactivé");
                  dismiss();
                } else setStep("new");
              }}
            />
          );
        } else if (step === "new") {
          body = (
            <PinPad
              key="new"
              title="Nouveau code"
              hint={note || "6 chiffres"}
              onDone={async (pin) => {
                first.current = pin;
                setNote("");
                setStep("confirm");
              }}
            />
          );
        } else {
          body = (
            <PinPad
              key="confirm"
              title="Confirme le code"
              onDone={async (pin) => {
                if (pin !== first.current) {
                  setNote("Les deux codes étaient différents");
                  setStep("new");
                  return;
                }
                try {
                  await setPin(pin);
                } catch (e) {
                  return e.message;
                }
                say("Code enregistré");
                dismiss();
              }}
            />
          );
        }
        return <div className="pinbox">{body}</div>;
      }}
    </Sheet>
  );
}
