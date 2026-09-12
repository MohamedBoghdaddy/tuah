/**
 * KPI/stat tile used across admin dashboards and list pages.
 * tone: "warn" | "danger" | undefined — tints the value color.
 */
const StatCard = ({ label, value, icon, tone, hint }) => (
  <div className={`ui-stat-card${tone ? ` ui-stat-card--${tone}` : ""}`}>
    <div className="ui-stat-card-top">
      <p className="ui-stat-card-label">{label}</p>
      {icon && (
        <span className="ui-stat-card-icon material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
      )}
    </div>
    <strong className="ui-stat-card-value">{value}</strong>
    {hint && <p className="ui-stat-card-hint">{hint}</p>}
  </div>
);

export default StatCard;
