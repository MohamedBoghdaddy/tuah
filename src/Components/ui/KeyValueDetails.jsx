/**
 * Label/value definition list for detail drawers and view modals
 * (replaces ad hoc <dl className="admin-detail-list"> markup per page).
 * items: [{ label, value, mono? }]
 */
const KeyValueDetails = ({ items = [], columns = 1 }) => (
  <dl className="ui-kv-details" style={{ "--ui-kv-columns": columns }}>
    {items
      .filter((item) => item.value !== undefined && item.value !== null && item.value !== "")
      .map((item) => (
        <div className="ui-kv-details-row" key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? "ui-kv-details-mono" : undefined}>{item.value}</dd>
        </div>
      ))}
  </dl>
);

export default KeyValueDetails;
