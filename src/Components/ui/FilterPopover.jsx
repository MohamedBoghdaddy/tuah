import { useEffect, useRef, useState } from "react";

/**
 * Generic filter popover for table toolbars.
 * filters: [{ key, label, options: [{ value, label }] }]
 * values:  { [key]: value }
 * onChange(key, value) — value === "" clears that filter.
 */
const FilterPopover = ({ filters = [], values = {}, onChange, onClear }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const activeCount = filters.filter((f) => values[f.key]).length;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!filters.length) return null;

  return (
    <div className="ui-filter-popover" ref={ref}>
      <button
        type="button"
        className={`ui-filter-popover-trigger${activeCount ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="material-symbols-outlined">filter_list</span>
        Filters
        {activeCount > 0 && <span className="ui-filter-popover-count">{activeCount}</span>}
      </button>

      {open && (
        <div className="ui-filter-popover-panel" role="dialog" aria-label="Filters">
          {filters.map((filter) => (
            <div className="ui-filter-popover-field" key={filter.key}>
              <label htmlFor={`filter-${filter.key}`}>{filter.label}</label>
              <select
                id={`filter-${filter.key}`}
                value={values[filter.key] || ""}
                onChange={(e) => onChange(filter.key, e.target.value)}
              >
                <option value="">All</option>
                {filter.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {activeCount > 0 && (
            <button type="button" className="ui-filter-popover-clear" onClick={onClear}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FilterPopover;
