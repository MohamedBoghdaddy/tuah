/**
 * Consistent error surface for failed data loads. Distinct from EmptyState so a
 * genuine "the request failed" case never reads like "there's nothing here."
 */
const ErrorState = ({ title = "Something went wrong", description, onRetry }) => (
  <div className="ui-error-state" role="alert">
    <span className="material-symbols-outlined ui-error-state-icon" aria-hidden="true">
      error
    </span>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    {onRetry && (
      <button type="button" className="admin-premium-button" onClick={onRetry}>
        <span className="material-symbols-outlined">refresh</span>
        Try again
      </button>
    )}
  </div>
);

export default ErrorState;
