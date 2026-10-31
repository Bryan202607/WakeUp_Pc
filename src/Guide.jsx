import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import Row from "./Row";
import { CHAPTERS } from "./guideData";
import agentSource from "../agent.py?raw"; // le programme de l'agent est embarqué dans l'appli

// {ORIGIN} devient l'adresse exacte de cette appli
const origins = () => Array.from(new Set([window.location.origin, "https://localhost"])).join(",");
const fill = (t) => t.split("{ORIGINS}").join(origins()).split("{ORIGIN}").join(window.location.origin);

// **gras** et `code` dans les textes
const rich = (t) =>
  fill(t)
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((s, i) =>
      s.startsWith("**") ? <b key={i}>{s.slice(2, -2)}</b> : s.startsWith("`") ? <code key={i}>{s.slice(1, -1)}</code> : s
    );

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

function CopyBtn({ text, label = "Copier" }) {
  const [state, setState] = useState("");
  const copy = async () => {
    setState((await copyText(text)) ? "ok" : "fail");
    setTimeout(() => setState(""), 1800);
  };
  return (
    <button className="mini soft" onClick={copy}>
      {state === "ok" ? "Copié" : state === "fail" ? "Échec" : label}
    </button>
  );
}

function AgentBlock() {
  const [msg, setMsg] = useState("");

  const share = async () => {
    try {
      const file = new File([agentSource], "agent.py", { type: "text/x-python" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "agent.py" });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "agent.py", text: agentSource });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    setMsg((await copyText(agentSource)) ? "Partage indisponible : le code a été copié." : "Partage indisponible.");
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <>
      <div className="gbar">
        <button className="mini" onClick={share}>
          Partager agent.py
        </button>
        <CopyBtn text={agentSource} label="Copier le code" />
      </div>
      {msg && <p className="foot">{msg}</p>}
    </>
  );
}

function Block({ b }) {
  switch (b.t) {
    case "h":
      return <div className="cap">{b.text}</div>;
    case "p":
      return <p className="gp">{rich(b.text)}</p>;
    case "list":
      return (
        <ul className="gl">
          {b.items.map((x, i) => (
            <li key={i}>{rich(x)}</li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="gl">
          {b.items.map((x, i) => (
            <li key={i}>{rich(x)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <>
          <pre className="gcode">{fill(b.text)}</pre>
          <div className="gbar">
            <CopyBtn text={fill(b.text)} />
          </div>
        </>
      );
    case "warn":
      return <p className="gwarn">{rich(b.text)}</p>;
    case "agent":
      return <AgentBlock />;
    default:
      return null;
  }
}

export default function Guide({ close }) {
  const [open, setOpen] = useState(null);
  const ch = CHAPTERS.find((c) => c.id === open);

  // Remonte en haut quand on change de chapitre
  useEffect(() => {
    const body = document.querySelector(".sheet-body");
    if (body) body.scrollTop = 0;
  }, [open]);

  return (
    <Sheet title={ch ? ch.title : "Guide d'utilisation"} onClose={close}>
      {() =>
        ch ? (
          <>
            <button className="link back" onClick={() => setOpen(null)}>
              ‹ Tous les chapitres
            </button>
            {ch.blocks.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </>
        ) : (
          <>
            <p className="foot center">Tout est dans l'appli, même sans connexion.</p>
            <div className="list guide-list">
              {CHAPTERS.map((c, i) => (
                <Row key={c.id} icon={c.icon} color={c.color} label={i + 1 + ". " + c.title} chevron onClick={() => setOpen(c.id)} />
              ))}
            </div>
          </>
        )
      }
    </Sheet>
  );
}
