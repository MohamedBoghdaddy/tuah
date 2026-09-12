/**
 * Honest "nothing here yet" state — used instead of ad hoc <p className="admin-empty">
 * strings scattered per page. Never render fabricated sample rows; this is the
 * legitimate substitute.
 */
const EmptyState = ({ icon = "inbox", title, description, action }) => (
  <div className="ui-empty-state" role="status">
    <span className="material-symbols-outlined ui-empty-state-icon" aria-hidden="true">
      {icon}
    </span>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    {action && <div className="ui-empty-state-action">{action}</div>}
  </div>
);

export default EmptyState;
