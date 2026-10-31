import Icon from "./icons";

// Une ligne de liste : pastille colorée + texte + détail + flèche.
// Sans onClick, c'est juste une ligne d'information.
export default function Row({ icon, color, label, detail, onClick, danger, accent, armed, chevron, flat }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={"row" + (armed ? " armed" : "") + (flat ? " flat" : "")} onClick={onClick}>
      {icon && (
        <span className="chip" style={{ background: color }}>
          <Icon name={icon} size={20} />
        </span>
      )}
      <span className={"label" + (danger && !armed ? " danger" : "") + (accent ? " accent" : "")}>
        {armed ? "Appuie pour confirmer" : label}
      </span>
      {armed ? <small>4 s</small> : detail ? <span className="detail">{detail}</span> : null}
      {chevron && !armed && (
        <span className="chev">
          <Icon name="chevron" size={16} />
        </span>
      )}
    </Tag>
  );
}
