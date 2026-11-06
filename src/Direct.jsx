import { useState } from "react";
import Sheet from "./Sheet";
import { save, isNative, scanLan, testDirect } from "./api";

// Connexion directe (sans internet) : chercher le PC et le relais sur le réseau, et comprendre ce qui ne va pas.
export function DirectSheet({ cfg, setCfg, close }) {
  const [scan, setScan] = useState({ state: "idle", prefix: "", found: [] });
  const [tests, setTests] = useState(null);
  const [busy, setBusy] = useState(false);
  const native = isNative();

  const persist = (next) => {
    setCfg(next);
    save(next);
  };

  const doScan = async () => {
    setTests(null);
    setScan({ state: "run", prefix: "", found: [] });
    const found = await scanLan((p) => setScan((s) => ({ ...s, prefix: p })), cfg.lanPcUrl || cfg.lanRelayUrl);
    const next = { ...cfg };
    for (const f of found) {
      if (f.mode === "relay") next.lanRelayUrl = f.url;
      else next.lanPcUrl = f.url;
    }
    if (found.length) persist(next);
    setScan({ state: "done", prefix: "", found });
  };

  const doTest = async () => {
    setBusy(true);
    setScan({ state: "idle", prefix: "", found: [] });
    const out = {};
    if (cfg.lanPcUrl) out.pc = await testDirect(cfg.lanPcUrl, cfg.pcToken);
    if (cfg.lanRelayUrl) out.relay = await testDirect(cfg.lanRelayUrl, cfg.relayToken);
    if (!out.pc && !out.relay) out.pc = await testDirect("", "");
    setTests(out);
    setBusy(false);
  };

  const steps = (list) => list.map((s, i) => (
    <p key={i} className={"diag " + (s.ok ? "ok" : "ko")}>
      <b>{s.ok ? "✔" : "✘"}</b> {s.text}
    </p>
  ));

  return (
    <Sheet title="Connexion directe" onClose={close}>
      {() => (
        <>
          {!native && (
            <p className="gwarn">
              Cette fonction ne marche que dans l'appli Android (l'APK). La page web ne peut pas joindre une adresse du réseau local, et
              elle ne s'ouvre pas sans internet.
            </p>
          )}

          <button className="big" disabled={!native || scan.state === "run"} onClick={doScan}>
            {scan.state === "run" ? "Recherche sur " + (scan.prefix || "…") : "Chercher le PC et le relais"}
          </button>
          <button className="ghost" disabled={busy} onClick={doTest}>
            {busy ? "Test en cours…" : "Tester la connexion"}
          </button>

          {scan.state === "done" &&
            (scan.found.length ? (
              <>
                <div className="cap">Trouvé et enregistré dans les réglages</div>
                {scan.found.map((f) => (
                  <p key={f.url} className="diag ok">
                    <b>✔</b> {f.mode === "relay" ? "Relais" : "PC"} : {f.url}
                  </p>
                ))}
                <p className="foot">Il reste à vérifier le token : appuie sur « Tester la connexion ».</p>
              </>
            ) : (
              <p className="diag ko">
                <b>✘</b> Rien trouvé. L'agent doit tourner avec LAN=1, sur le même réseau que le téléphone, et le pare-feu Windows doit laisser passer le port.
                Si le PC partage sa connexion (point d'accès Windows), essaie l'adresse 192.168.137.1 dans la ligne « Direct ».
              </p>
            ))}

          {tests && (
            <>
              {tests.pc && (
                <>
                  <div className="cap">PC</div>
                  {steps(tests.pc)}
                </>
              )}
              {tests.relay && (
                <>
                  <div className="cap">Relais</div>
                  {steps(tests.relay)}
                </>
              )}
            </>
          )}

          <p className="foot">
            Si le téléphone est connecté à un Wi-Fi sans internet, coupe les données mobiles : Android envoie parfois tout par la 4G ou la 5G et ne
            voit plus le PC.
          </p>
        </>
      )}
    </Sheet>
  );
}
