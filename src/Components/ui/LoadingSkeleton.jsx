/**
 * Shimmer skeleton built on the existing .skeleton keyframe animation in
 * design-system.css. Use `rows`/`variant` to roughly match the shape of the
 * content it's standing in for, so layout doesn't jump on load.
 */
const LoadingSkeleton = ({ variant = "rows", rows = 4, height = 16 }) => {
  if (variant === "table") {
    return (
      <div className="ui-skeleton-table" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="ui-skeleton-table-row" key={i}>
            <span className="skeleton" style={{ height, width: "28px", borderRadius: "6px" }} />
            <span className="skeleton" style={{ height, flex: 2 }} />
            <span className="skeleton" style={{ height, flex: 1 }} />
            <span className="skeleton" style={{ height, flex: 1 }} />
            <span className="skeleton" style={{ height, width: "72px" }} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className="ui-skeleton-cards" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="skeleton ui-skeleton-card" key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="ui-skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <span className="skeleton" style={{ height }} key={i} />
      ))}
    </div>
  );
};

export default LoadingSkeleton;
