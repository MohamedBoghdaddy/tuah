import { useDialogA11y } from "./useDialogA11y";

/**
 * Replaces window.confirm() for destructive/high-risk admin actions
 * (delete, archive, cancel, reject). Accessible modal: focus-trapped,
 * closes on Escape or overlay click, returns focus to the trigger on close.
 */
const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const containerRef = useDialogA11y(open, onCancel);

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- mouse-only backdrop dismiss; keyboard users already get Escape via useDialogA11y
    <div className="ui-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="ui-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ui-confirm-dialog-title"
        tabIndex={-1}
        ref={containerRef}
      >
        <h2 id="ui-confirm-dialog-title">{title}</h2>
        {description && <p className="ui-dialog-description">{description}</p>}
        <div className="ui-dialog-actions">
          <button type="button" className="admin-premium-button" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`admin-premium-button${danger ? " danger" : " primary"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
