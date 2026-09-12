import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDialogA11y } from "./useDialogA11y";

/**
 * Ctrl/Cmd+K jump-to-page search. This is the ERP shell's "global search
 * entry point" — it searches real navigation destinations (not fabricated
 * records), so it's honest about what it can find today: pages, not yet
 * customers/orders/products (those need a real search API — see
 * services/api.js when one exists).
 *
 * items: [{ id, label, group, href, icon }]
 */
const CommandPalette = ({ open, onClose, items }) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const containerRef = useDialogA11y(open, onClose);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 8);
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) || item.group?.toLowerCase().includes(needle)
    );
  }, [items, query]);

  useEffect(() => {
    if (open) { setQuery(""); setActiveIndex(0); }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const go = (item) => {
    if (!item) return;
    onClose();
    navigate(item.href);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[activeIndex]);
    }
  };

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- mouse-only backdrop dismiss; keyboard users already get Escape via useDialogA11y
    <div className="ui-dialog-backdrop ui-command-palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="ui-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to page"
        tabIndex={-1}
        ref={containerRef}
      >
        <div className="ui-command-palette-input">
          <span className="material-symbols-outlined">search</span>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: this is a Cmd/Ctrl+K palette the user just explicitly opened
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page… (Orders, Products, Employees, Settings…)"
            aria-label="Jump to a page"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="ui-command-palette-results" role="listbox">
          {results.length === 0 && <li className="ui-command-palette-empty">No matching pages.</li>}
          {results.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`ui-command-palette-result${index === activeIndex ? " active" : ""}`}
                onClick={() => go(item)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="material-symbols-outlined">{item.icon || "arrow_forward"}</span>
                <span>
                  <strong>{item.label}</strong>
                  {item.group && <small>{item.group}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;
