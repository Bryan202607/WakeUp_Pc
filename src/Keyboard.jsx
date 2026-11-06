import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import { buzz } from "./util";

// Clavier plein écran. Les lettres sont envoyées comme du texte (accents compris, quel que soit le clavier du PC),
// Ctrl / Alt / Win restent « collés » jusqu'à la touche suivante pour faire des raccourcis (Ctrl puis C = copier).

const T = (label, text, w) => ({ label, text, w });
const K = (label, key, w, repeat) => ({ label, key, w, repeat });
const chars = (s) => s.split("").map((c) => T(c, c));

const bottom = (a, b) => [
  { label: a[0], layer: a[1], w: 1.4 },
  { label: b[0], layer: b[1], w: 1.4 },
  { label: "Ctrl", mod: "ctrl", w: 1.2 },
  { label: "Alt", mod: "alt", w: 1.2 },
  { label: "Win", mod: "win", w: 1.2 },
  { label: "espace", text: " ", w: 4 },
  K("Entrée", "enter", 2),
];

const LAYERS = {
  abc: [
    { small: true, keys: chars("éèêàùçôîâûëï") },
    { keys: chars("azertyuiop") },
    { keys: chars("qsdfghjklm") },
    { keys: [{ label: "⇧", mod: "shift", w: 1.6 }, ...chars("wxcvbn"), K("⌫", "backspace", 1.6, true)] },
    { keys: bottom(["123", "sym"], ["Fn", "fn"]) },
  ],
  sym: [
    { keys: chars("1234567890") },
    { keys: chars("@#€_&-+()/") },
    { keys: [...chars("*\"':;!?%="), K("⌫", "backspace", 1.4, true)] },
    { keys: chars("~^`<>[]{}\\|") },
    { keys: bottom(["ABC", "abc"], ["Fn", "fn"]) },
  ],
  fn: [
    { keys: [K("Échap", "esc"), ...[1, 2, 3, 4, 5, 6].map((n) => K("F" + n, "f" + n))] },
    { keys: [K("Tab", "tab"), ...[7, 8, 9, 10, 11, 12].map((n) => K("F" + n, "f" + n))] },
    { keys: [K("Début", "home"), K("↑", "up", 1, true), K("Fin", "end"), K("Page ↑", "pageup"), K("Insér", "insert"), K("Impr", "prtsc")] },
    { keys: [K("←", "left", 1, true), K("↓", "down", 1, true), K("→", "right", 1, true), K("Page ↓", "pagedown"), K("Suppr", "delete", 1, true), K("⌫", "backspace", 1, true)] },
    { keys: bottom(["ABC", "abc"], ["123", "sym"]) },
  ],
};

export function KeyboardScreen({ go, close, toPad }) {
  const [layer, setLayer] = useState("abc");
  const [mods, setMods] = useState({ ctrl: false, alt: false, win: false });
  const [shift, setShift] = useState(0); // 0 = non, 1 = pour une lettre, 2 = verrouillé (majuscules)

  const modsRef = useRef(mods);
  const shiftRef = useRef(0);
  const pending = useRef("");
  const flushTimer = useRef(null);
  const repeat = useRef(null);
  const chain = useRef(Promise.resolve());

  const setM = (m) => {
    modsRef.current = m;
    setMods(m);
  };
  const setS = (s) => {
    shiftRef.current = s;
    setShift(s);
  };

  // Les envois partent dans l'ordre, l'un après l'autre
  const send = (body) => {
    chain.current = chain.current.then(() => go("key", { body, quiet: true }));
  };
  const flush = () => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const s = pending.current;
    pending.current = "";
    if (s) send({ text: s });
  };
  const queue = (ch) => {
    pending.current += ch;
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, 30); // on regroupe les lettres tapées vite
  };
  const clearMods = () => {
    setM({ ctrl: false, alt: false, win: false });
    if (shiftRef.current === 1) setS(0);
  };

  const press = (key) => {
    buzz(5);
    if (key.layer) return setLayer(key.layer);
    if (key.mod === "shift") return setS(shiftRef.current === 0 ? 1 : shiftRef.current === 1 ? 2 : 0);
    if (key.mod) return setM({ ...modsRef.current, [key.mod]: !modsRef.current[key.mod] });

    const m = modsRef.current;
    const act = ["ctrl", "alt", "win"].filter((x) => m[x]).slice(0, 2);
    const sh = shiftRef.current !== 0;

    if (key.text !== undefined) {
      if (act.length && /^[a-z0-9]$/i.test(key.text)) {
        flush();
        send({ combo: [...act, ...(sh ? ["shift"] : []), key.text.toLowerCase()] });
        return clearMods();
      }
      queue(sh ? key.text.toUpperCase() : key.text);
      if (shiftRef.current === 1) setS(0);
      return;
    }
    flush();
    if (act.length || sh) {
      send({ combo: [...act, ...(sh ? ["shift"] : []), key.key] });
      clearMods();
    } else {
      send({ key: key.key });
    }
  };

  const stop = () => {
    clearTimeout(repeat.current);
    clearInterval(repeat.current);
    repeat.current = null;
  };
  const down = (e, key) => {
    e.preventDefault();
    e.currentTarget.classList.add("down");
    press(key);
    if (key.repeat) {
      stop();
      repeat.current = setTimeout(() => {
        repeat.current = setInterval(() => press(key), 80); // touche maintenue : elle se répète
      }, 380);
    }
  };
  const up = (e) => {
    e.currentTarget.classList.remove("down");
    stop();
  };

  useEffect(
    () => () => {
      stop();
      flush();
    },
    []
  );

  const upper = shift !== 0;

  return (
    <div className="fs">
      <div className="fs-top">
        <button className="fs-btn" onClick={close}>
          <Icon name="back" size={20} /> Quitter
        </button>
        <span className="fs-grow" />
        <button className="fs-btn" onClick={toPad}>
          Pavé tactile
        </button>
      </div>
      <div className="kb">
        {LAYERS[layer].map((row, i) => (
          <div key={layer + i} className={"kb-row" + (row.small ? " small" : "")}>
            {row.keys.map((key, j) => {
              const active = key.mod === "shift" ? shift !== 0 : key.mod ? mods[key.mod] : false;
              const label = key.text !== undefined && key.text !== " " && upper ? key.label.toUpperCase() : key.label;
              const cls = "k" + (key.mod || key.layer ? " mod" : "") + (active ? " on" : "") + (label.length > 2 ? " long" : "");
              return (
                <button
                  key={j}
                  className={cls}
                  style={{ "--w": key.w || 1 }}
                  onPointerDown={(e) => down(e, key)}
                  onPointerUp={up}
                  onPointerLeave={up}
                  onPointerCancel={up}
                >
                  {key.mod === "shift" && shift === 2 ? "⇪" : label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
