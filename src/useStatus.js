import { useEffect, useState } from "react";
import { call } from "./api";

export default function useStatus(base, token) {
  const [status, setStatus] = useState(base && token ? "check" : "none");

  useEffect(() => {
    if (!base || !token) {
      setStatus("none");
      return;
    }
    let alive = true;

    const tick = async () => {
      try {
        await call(base, token, "ping");
        if (alive) setStatus("on");
      } catch (e) {
        if (alive) setStatus(e.code === 401 || e.code === 429 ? "denied" : "off");
      }
    };

    tick();
    const id = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [base, token]);

  return status;
}
