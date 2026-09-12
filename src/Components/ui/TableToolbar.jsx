import SearchInput from "./SearchInput";
import FilterPopover from "./FilterPopover";

/**
 * Toolbar row above a DataTable: title/count, search, filters, and
 * page-level actions. When rows are selected, it swaps to a bulk-action bar.
 */
const TableToolbar = ({
  title,
  count,
  search,
  filters,
  actions,
  selectedCount = 0,
  bulkActions = [],
  onClearSelection,
}) => {
  if (selectedCount > 0 && bulkActions.length > 0) {
    return (
      <div className="ui-table-toolbar ui-table-toolbar--bulk">
        <div className="ui-table-toolbar-bulk-info">
          <button
            type="button"
            className="ui-table-toolbar-bulk-clear"
            onClick={onClearSelection}
            aria-label="Clear selection"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <strong>{selectedCount} selected</strong>
        </div>
        <div className="ui-table-toolbar-bulk-actions">
          {bulkActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`admin-premium-button${action.danger ? " danger" : ""}`}
              onClick={action.onClick}
            >
              {action.icon && <span className="material-symbols-outlined">{action.icon}</span>}
              {action.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ui-table-toolbar">
      <div className="ui-table-toolbar-title">
        {title && <h2 className="admin-section-title">{title}</h2>}
        {count != null && <span className="ui-table-toolbar-count">{count}</span>}
      </div>
      <div className="ui-table-toolbar-tools">
        {search && (
          <SearchInput value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
        )}
        {filters && <FilterPopover {...filters} />}
        {actions}
      </div>
    </div>
  );
};

export default TableToolbar;
