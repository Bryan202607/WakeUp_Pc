import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { animate } from "motion";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Plus on tire au-delà du bord, moins la feuille suit
const rubberband = (overshoot, dimension, c = 0.55) =>
  (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));

// Où la feuille s'arrêterait si on la lançait avec cette vitesse (px/s)
const project = (v, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);

export default function Sheet({ title, onClose, children }) {
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);
  const y = useRef(0); // position réelle à l'écran
  const height = useRef(600);
  const anim = useRef(null);
  const drag = useRef(null);

  const render = useCallback((v) => {
    y.current = v;
    const p = Math.min(1, Math.max(0, 1 - v / height.current));
    if (sheetRef.current) sheetRef.current.style.transform = "translate3d(0," + v + "px,0)";
    if (scrimRef.current) scrimRef.current.style.opacity = p;
    document.documentElement.style.setProperty("--push", p);
  }, []);

  const move = useCallback(
    (to, { velocity = 0, bounce = 0, done } = {}) => {
      if (anim.current) anim.current.stop();
      if (reduced()) {
        render(to);
        if (done) done();
        return;
      }
      anim.current = animate(y.current, to, {
        type: "spring",
        bounce,
        duration: 0.4,
        velocity,
        onUpdate: render,
        onComplete: () => done && done(),
      });
    },
    [render]
  );

  const measure = useCallback(() => {
    if (sheetRef.current) height.current = sheetRef.current.offsetHeight + 40;
  }, []);

  const finish = useCallback(() => {
    if (y.current >= height.current - 1) onClose();
  }, [onClose]);

  const dismiss = useCallback(() => {
    measure();
    move(height.current, { done: finish });
  }, [measure, move, finish]);

  useLayoutEffect(() => {
    height.current = sheetRef.current.offsetHeight + 40;
    render(height.current);
    move(0);
    return () => {
      if (anim.current) anim.current.stop();
      document.documentElement.style.setProperty("--push", 0);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    measure();
    if (anim.current) anim.current.stop();
    drag.current = {
      startY: e.clientY,
      start: y.current,
      hist: [{ t: performance.now(), y: e.clientY }],
    };
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const raw = d.start + (e.clientY - d.startY);
    render(raw < 0 ? rubberband(raw, height.current) : raw);
    d.hist.push({ t: performance.now(), y: e.clientY });
    if (d.hist.length > 6) d.hist.shift();
  };

  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const a = d.hist[0];
    const b = d.hist[d.hist.length - 1];
    const v = b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
    const closing = y.current + project(v) > height.current * 0.5;
    move(closing ? height.current : 0, {
      velocity: v,
      bounce: closing ? 0 : 0.15,
      done: closing ? finish : undefined,
    });
  };

  return (
    <div className="overlay">
      <div className="scrim" ref={scrimRef} onClick={dismiss} />
      <div className="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={title}>
        <div
          className="grab"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="handle" />
          <h2 className="sheet-title">{title}</h2>
        </div>
        <div className="sheet-body">{children({ dismiss })}</div>
      </div>
    </div>
  );
}
