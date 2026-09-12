import { getStatusTone, formatStatusLabel } from "../../utils/statusSemantics";

const TONE_CLASS = {
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-error",
  info: "badge-info",
  neutral: "badge-neutral",
};

/**
 * Single source of truth for status pills across the admin/ERP UI.
 * Pass the raw status string; color + label are derived from
 * utils/statusSemantics.js so the same word always renders the same way.
 *
 *   <StatusBadge status="in_production" />
 *   <StatusBadge status="paid" label="Paid in Full" />
 */
const StatusBadge = ({ status, label, tone, className = "" }) => {
  const resolvedTone = tone || getStatusTone(status);
  const toneClass = TONE_CLASS[resolvedTone] || TONE_CLASS.neutral;
  const text = label || formatStatusLabel(status);

  return <span className={`badge-status ${toneClass} ${className}`.trim()}>{text}</span>;
};

export default StatusBadge;
