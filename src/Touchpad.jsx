import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import { buzz } from "./util";
import { streamUrl, shotUrl } from "./api";

// Pavé tactile plein écran, comme celui d'un ordinateur portable.
//  1 doigt : déplacer (avec accélération)        tap : clic gauche
//  2 doigts : défiler (haut/bas et côtés)        tap à 2 doigts : clic droit     pincer : zoom
//  3 doigts : glisser vers le haut = vue des tâches, vers le bas = bureau, côtés = changer de fenêtre
//  tap puis poser le doigt et glisser : glisser-déposer
//  bande du bas : boutons gauche et droit (on peut les garder appuyés et bouger un autre doigt)
// Option « écran » : le tiers du haut montre l'écran du PC en vidéo (de 3 à 60 images par seconde).

const SPEEDS = [0.8, 1.2, 1.7, 2.4];
const TAP_MS = 260;
const TAP_PX = 10;
const DOUBLE_MS = 320;
const SCROLL_PX = 26;
const HINT = "Glisse pour déplacer\nTouche pour cliquer\nDeux doigts : défiler, clic droit, zoom\nTrois doigts : changer de fenêtre";

const fresh = () => ({ t2: 0, start: 0, moved: 0, most: 0, mode: null, cx: 0, cy: 0, dist: 0, sx: 0, sy: 0, swiped: false, dragArm: false, dragging: false });

const storedSpeed = () => {
  try {
    return Number(localStorage.getItem("pcr_speed")) || 2;
  } catch (e) {
    return 2;
  }
};

// ---------------------------------------------------------------------------
// La vidéo : un flux d'images que l'agent adapte tout seul (rapide quand l'écran bouge, lent quand il est fixe).
// Si le téléphone n'arrive pas à lire le flux, on retombe sur des images demandées une par une.
// ---------------------------------------------------------------------------
function ScreenVideo({ route }) {
  const [src, setSrc] = useState("");
  const [mode, setMode] = useState("stream"); // stream | poll
  const [epoch, setEpoch] = useState(0); // augmente pour se reconnecter
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const lastErr = useRef(0);
  const dead = useRef(0);

  // connexion au flux
  useEffect(() => {
    if (mode !== "stream") return;
    let on = true;
    setErr("");
    streamUrl(route.base, route.token, { w: 800, fps: 60 })
      .then((u) => on && setSrc(u))
      .catch(() => on && setErr("Injoignable"));
    return () => {
      on = false;
      setSrc(""); // retirer l'image ferme la connexion
    };
  }, [mode, epoch]);

  // secours : une image après l'autre, le plus vite possible
  const [pollFps, setPollFps] = useState(0);
  useEffect(() => {
    if (mode !== "poll") return;
    let on = true;
    let count = 0;
    let t0 = Date.now();
    (async () => {
      while (on) {
        try {
          const url = await shotUrl(route.base, route.token, { w: 640, live: 1 });
          await new Promise((res) => {
            const im = new Image();
            im.onload = () => {
              if (on) setSrc(url);
              count++;
              res();
            };
            im.onerror = () => res();
            im.src = url;
          });
        } catch (e) {
          await new Promise((r) => setTimeout(r, 800));
        }
        if (Date.now() - t0 > 1000) {
          setPollFps(Math.round((count * 1000) / (Date.now() - t0)));
          count = 0;
          t0 = Date.now();
        }
      }
    })();
    return () => {
      on = false;
    };
  }, [mode]);

  // chiffres affichés + détection d'un flux mort
  useEffect(() => {
    if (mode !== "stream") return;
    let on = true;
    const id = setInterval(async () => {
      try {
        const j = await route.call("streaminfo");
        if (!on) return;
        setInfo(j);
        dead.current = j && j.fps > 0 ? 0 : dead.current + 1;
        if (dead.current >= 3) {
          dead.current = 0;
          setEpoch((n) => n + 1); // plus d'images depuis 4 secondes : on se reconnecte
        }
      } catch (e) {}
    }, 1500);
    const onVis = () => !document.hidden && setEpoch((n) => n + 1);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      on = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mode]);

  const onError = () => {
    const now = Date.now();
    if (now - lastErr.current < 5000) {
      setMode("poll"); // deux erreurs de suite : ce téléphone ne lit pas le flux
    } else {
      setEpoch((n) => n + 1);
    }
    lastErr.current = now;
  };

  const label = mode === "poll" ? pollFps + " i/s · images" : info && info.fps ? Math.round(info.fps) + " i/s · " + info.w + " px" : "connexion…";

  return (
    <div className="fs-video" data-nopad>
      {src && !err ? <img src={src} alt="Écran du PC" draggable={false} onError={mode === "stream" ? onError : undefined} /> : <div className="shot-empty">{err || "Connexion à l'écran…"}</div>}
      <span className="fs-info">{label}</span>
    </div>
  );
}

export function TouchpadScreen({ go, close, toKeyboard, route, video: initialVideo }) {
  const [speed, setSpeed] = useState(storedSpeed);
  const [label, setLabel] = useState("");
  const [touched, setTouched] = useState(false);
  const [video, setVideo] = useState(Boolean(initialVideo));

  const root = useRef(null);
  const layer = useRef(null);
  const zone = useRef(null);
  const ptrs = useRef(new Map());
  const dots = useRef(new Map());
  const acc = useRef({ dx: 0, dy: 0, sc: 0, hs: 0, zm: 0 });
  const ops = useRef([]); // file d'envoi ordonnée : mouvements et clics partent dans l'ordre où ils ont eu lieu
  const busy = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const st = useRef(fresh());
  const held = useRef({ left: false, right: false });
  const labelRef = useRef("");
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const say = (t) => {
    if (labelRef.current !== t) {
      labelRef.current = t;
      setLabel(t);
    }
  };

  // ---- envoi : un seul à la fois, et tout ce qui s'est accumulé pendant l'attente part d'un coup
  const take = () => {
    const a = acc.current;
    const m = { dx: Math.trunc(a.dx), dy: Math.trunc(a.dy), scroll: Math.trunc(a.sc), hscroll: Math.trunc(a.hs), zoom: Math.trunc(a.zm) };
    if (!m.dx && !m.dy && !m.scroll && !m.hscroll && !m.zoom) return null;
    a.dx -= m.dx;
    a.dy -= m.dy;
    a.sc -= m.scroll;
    a.hs -= m.hscroll;
    a.zm -= m.zoom;
    return m;
  };

  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let i = 0; i < 200; i++) {
        const body = ops.current.length ? ops.current.shift() : take();
        if (!body) break;
        await go("mouse", { body, quiet: true });
      }
    } finally {
      busy.current = false;
    }
  };

  const btn = (b, act) => {
    const m = take();
    if (m) ops.current.push(m); // le mouvement qui précède le clic part avant lui
    ops.current.push({ btn: b, act });
    pump();
  };
  const press = (side) => {
    if (held.current[side]) return;
    held.current[side] = true;
    buzz(10);
    btn(side, "down");
  };
  const release = (side) => {
    if (!held.current[side]) return;
    held.current[side] = false;
    btn(side, "up");
  };
  const click = (b) => {
    buzz(6);
    btn(b, "click");
  };

  // ---- doigts posés sur le pavé (hors bande du bas)
  const pads = () => Array.from(ptrs.current.values()).filter((p) => p.kind === "pad");
  const stats = (list) => {
    const n = list.length;
    const cx = list.reduce((s, p) => s + p.x, 0) / n;
    const cy = list.reduce((s, p) => s + p.y, 0) / n;
    const dist = n === 2 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
    return { cx, cy, dist };
  };
  const rebase = () => {
    const list = pads();
    if (!list.length) return;
    const s = stats(list);
    const g = st.current;
    g.cx = s.cx;
    g.cy = s.cy;
    g.dist = s.dist;
    if (list.length === 3) {
      g.sx = s.cx;
      g.sy = s.cy;
    }
    g.mode = null;
    g.t2 = Date.now();
    list.forEach((p) => {
      p.ox = p.x;
      p.oy = p.y;
    });
  };

  // ---- points qui montrent où sont les doigts
  const dotAt = (id, x, y) => {
    let d = dots.current.get(id);
    if (!d) {
      d = document.createElement("i");
      if (layer.current) layer.current.appendChild(d);
      dots.current.set(id, d);
    }
    d.style.transform = "translate(" + x + "px," + y + "px)";
  };
  const dotOff = (id) => {
    const d = dots.current.get(id);
    if (d) {
      d.remove();
      dots.current.delete(id);
    }
  };

  const onDown = (e) => {
    if (e.target.closest && e.target.closest("[data-nopad]")) return;
    try {
      root.current.setPointerCapture(e.pointerId);
    } catch (err) {}
    const zoneTop = zone.current ? zone.current.getBoundingClientRect().top : Infinity;
    const r = root.current.getBoundingClientRect();
    const inBtn = e.clientY >= zoneTop;
    const p = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, kind: inBtn ? "btn" : "pad", side: e.clientX < r.left + r.width / 2 ? "left" : "right" };
    ptrs.current.set(e.pointerId, p);
    dotAt(e.pointerId, e.clientX, e.clientY);
    setTouched(true);
    if (inBtn) return press(p.side);

    const list = pads();
    if (list.length === 1) {
      st.current = { ...fresh(), start: Date.now(), most: 1 };
      const lt = lastTap.current;
      // tap puis doigt reposé tout de suite à côté : on va glisser-déposer
      st.current.dragArm = Date.now() - lt.t < DOUBLE_MS && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 70;
    } else {
      st.current.most = Math.max(st.current.most, list.length);
    }
    rebase();
  };

  const onMove = (e) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    dotAt(e.pointerId, e.clientX, e.clientY);
    if (p.kind === "btn") return;

    const list = pads();
    const g = st.current;
    g.moved += Math.abs(dx) + Math.abs(dy);

    if (list.length === 1) {
      if (g.dragArm && !g.dragging && g.moved > 6) {
        g.dragging = true;
        press("left");
        say("Glisser-déposer");
      }
      const k = SPEEDS[speedRef.current - 1] * (1 + Math.min(Math.hypot(dx, dy) / 14, 1.3)); // accélération, comme un vrai pavé
      acc.current.dx += dx * k;
      acc.current.dy += dy * k;
    } else if (list.length === 2) {
      const [p1, p2] = list;
      const s = stats(list);
      if (!g.mode) {
        // deux doigts qui vont dans le même sens = défilement ; dans des sens opposés = pincement
        const v1 = [p1.x - p1.ox, p1.y - p1.oy];
        const v2 = [p2.x - p2.ox, p2.y - p2.oy];
        const m1 = Math.hypot(v1[0], v1[1]);
        const m2 = Math.hypot(v2[0], v2[1]);
        if (m1 > 6 && m2 > 6) {
          const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2);
          g.mode = cos < -0.2 ? "pinch" : "scroll";
        } else if (Date.now() - g.t2 > 150 && ((m1 > 14 && m2 < 2) || (m2 > 14 && m1 < 2))) {
          g.mode = "pinch"; // un doigt reste vraiment immobile (depuis plus de 150 ms), l'autre s'éloigne ou se rapproche
        }
        if (g.mode) {
          g.cx = s.cx;
          g.cy = s.cy;
          g.dist = s.dist;
        }
      } else {
        if (g.mode === "scroll") {
          acc.current.sc += -(s.cy - g.cy) / SCROLL_PX; // défilement « naturel » : le contenu suit les doigts
          acc.current.hs += -(s.cx - g.cx) / SCROLL_PX;
          say("Défilement");
        } else {
          acc.current.zm += (s.dist - g.dist) / 45;
          say("Zoom");
        }
        g.cx = s.cx;
        g.cy = s.cy;
        g.dist = s.dist;
      }
    } else if (list.length === 3 && !g.swiped) {
      const s = stats(list);
      const mx = s.cx - g.sx;
      const my = s.cy - g.sy;
      if (Math.hypot(mx, my) > 70) {
        g.swiped = true;
        buzz(10);
        const vertical = Math.abs(my) > Math.abs(mx);
        const combo = vertical ? (my < 0 ? ["win", "tab"] : ["win", "d"]) : mx < 0 ? ["alt", "shift", "tab"] : ["alt", "tab"];
        go("key", { body: { combo }, quiet: true });
        say(vertical ? (my < 0 ? "Vue des tâches" : "Bureau") : "Changer de fenêtre");
      }
    }
    pump(); // on envoie tout de suite, sans attendre un minuteur
  };

  const onUp = (e) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    ptrs.current.delete(e.pointerId);
    dotOff(e.pointerId);
    if (p.kind === "btn") return release(p.side);

    const g = st.current;
    if (pads().length === 0) {
      if (g.dragging) {
        g.dragging = false;
        release("left");
      } else if (Date.now() - g.start < TAP_MS && g.moved < TAP_PX * Math.max(1, g.most) && !g.swiped && !g.mode) {
        if (g.most === 1) {
          click("left");
          lastTap.current = { t: Date.now(), x: p.x, y: p.y };
        } else if (g.most === 2) click("right");
        else click("middle");
      }
      say("");
      pump();
    } else {
      rebase(); // un doigt est parti : on repart de zéro avec ceux qui restent
    }
  };

  useEffect(
    () => () => {
      ["left", "right"].forEach((s) => held.current[s] && go("mouse", { body: { btn: s, act: "up" }, quiet: true })); // on relâche tout en partant
    },
    []
  );

  const cycle = () => {
    const next = (speed % 4) + 1;
    setSpeed(next);
    try {
      localStorage.setItem("pcr_speed", String(next));
    } catch (e) {}
  };

  // la vidéo a besoin d'appeler l'agent (chiffres), on lui prête la même route
  const vroute = route ? { ...route, call: (id) => go(id, { quiet: true }) } : null;

  return (
    <div className={"fs" + (video ? " split" : "")} ref={root} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {video && vroute && <ScreenVideo route={vroute} />}
      <div className="fs-top" data-nopad>
        <button className="fs-btn" onClick={close}>
          <Icon name="back" size={20} /> Quitter
        </button>
        <span className="fs-grow" />
        <button className={"fs-ico" + (video ? " on" : "")} onClick={() => setVideo((v) => !v)} aria-label="Afficher l'écran du PC">
          <Icon name="monitor" size={22} />
        </button>
        <button className="fs-ico" onClick={cycle} aria-label="Vitesse">
          ×{speed}
        </button>
        <button className="fs-ico" onClick={toKeyboard} aria-label="Clavier">
          <Icon name="keyboard" size={22} />
        </button>
      </div>
      <div className="fs-dots" ref={layer} />
      <div className="fs-hint">{label || (touched ? "" : HINT)}</div>
      <div className="fs-bottom" ref={zone}>
        <div>Clic gauche</div>
        <div>Clic droit</div>
      </div>
    </div>
  );
}
