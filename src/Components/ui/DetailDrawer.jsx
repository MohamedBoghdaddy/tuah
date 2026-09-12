import { useDialogA11y } from "./useDialogA11y";

/**
 * Right-side slide-in drawer for viewing/editing a single record (order,
 * customer, employee, etc.) without leaving the list. Accessible: focus
 * trapped while open, Escape/overlay-click to close, focus restored after.
 */
const DetailDrawer = ({ open, title, subtitle, onClose, actions, children, width = 480 }) => {
  const containerRef = useDialogA11y(open, onClose);

  if (!open) return null;

  return (
    <>
      <div className="ui-drawer-overlay" onClick={onClose} />
      <aside
        className="ui-detail-drawer"
        style={{ width, maxWidth: "92vw" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-detail-drawer-title"
        tabIndex={-1}
        ref={containerRef}
      >
        <header className="ui-detail-drawer-header">
          <div>
            <h2 id="ui-detail-drawer-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ui-detail-drawer-close" onClick={onClose} aria-label="Close panel">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="ui-detail-drawer-body">{children}</div>
        {actions && <footer className="ui-detail-drawer-footer">{actions}</footer>}
      </aside>
    </>
  );
};

export default DetailDrawer;
