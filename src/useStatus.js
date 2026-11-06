import { useEffect, useRef, useState } from "react";
import { call } from "./api";

export default function useStatus(base, token, onInfo) {
  const [status, setStatus] = useState(base && token ? "check" : "none");
  const cb = useRef(onInfo);
  cb.current = onInfo;

  useEffect(() => {
    if (!base || !token) {
      setStatus("none");
      return;
    }
    let alive = true;
    setStatus("check");

    const tick = async () => {
      if (document.hidden) return; // appli en arrière-plan : on économise la batterie et le réseau
      try {
        const j = await call(base, token, "ping");
        if (alive) {
          setStatus("on");
          if (cb.current) cb.current(j);
        }
      } catch (e) {
        if (alive) setStatus(e.code === 401 || e.code === 429 ? "denied" : "off");
      }
    };

    tick();
    const id = setInterval(tick, 8000);
    const onVis = () => tick(); // au retour dans l'appli, on revérifie tout de suite
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [base, token]);

  return status;
}
