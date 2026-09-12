/**
 * Vertical activity/audit-log feed — order status history, approval steps,
 * employee invite events, etc.
 * events: [{ id, icon?, title, description?, timestamp, tone? }]
 */
const ActivityTimeline = ({ events = [], emptyLabel = "No activity yet." }) => {
  if (events.length === 0) {
    return <p className="ui-activity-timeline-empty">{emptyLabel}</p>;
  }

  return (
    <ol className="ui-activity-timeline">
      {events.map((event) => (
        <li key={event.id} className={`ui-activity-timeline-item${event.tone ? ` ui-activity-timeline-item--${event.tone}` : ""}`}>
          <span className="ui-activity-timeline-dot material-symbols-outlined" aria-hidden="true">
            {event.icon || "fiber_manual_record"}
          </span>
          <div className="ui-activity-timeline-content">
            <p className="ui-activity-timeline-title">{event.title}</p>
            {event.description && <p className="ui-activity-timeline-desc">{event.description}</p>}
            {event.timestamp && (
              <time className="ui-activity-timeline-time" dateTime={event.timestamp}>
                {new Date(event.timestamp).toLocaleString()}
              </time>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
};

export default ActivityTimeline;
