import { useMemo, useState } from "react";
import TableToolbar from "./TableToolbar";
import Pagination from "./Pagination";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import LoadingSkeleton from "./LoadingSkeleton";

/**
 * Generic, client-side data table: search, sort, pagination, filters, row
 * actions, and bulk selection/actions. Built for the admin/ERP tables that
 * today each hand-roll their own <table> markup — pass it columns + rows and
 * it handles the rest. Not a virtualization/server-pagination framework;
 * for the current row counts (tens to low hundreds) client-side is the right
 * amount of engineering.
 *
 * columns: [{ key, header, render?(row), sortValue?(row), sortable?, width?, align? }]
 * rows: full row array (unfiltered)
 * rowKey(row): string — required, must be stable/unique
 * searchFn(row, query): boolean — optional; if omitted, search box is not shown
 * filters: { filters: [{key,label,options}], filterFn(row, values) } — optional
 * rowActions(row): [{ label, icon, onClick, danger }] — optional, rendered per row
 * bulkActions: [{ label, icon, onClick(selectedRows), danger }] — optional, enables checkboxes
 * onRowClick(row) — optional
 */
const DataTable = ({
  title,
  columns,
  rows,
  rowKey,
  searchFn,
  searchPlaceholder = "Search…",
  filters,
  rowActions,
  bulkActions,
  onRowClick,
  toolbarActions,
  pageSize = 10,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyDescription,
}) => {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState({});
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());

  const filtered = useMemo(() => {
    let result = rows;
    if (searchFn && query.trim()) {
      result = result.filter((row) => searchFn(row, query.trim()));
    }
    if (filters?.filterFn && Object.keys(filterValues).some((k) => filterValues[k])) {
      result = result.filter((row) => filters.filterFn(row, filterValues));
    }
    return result;
  }, [rows, query, filterValues, filters, searchFn]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return filtered;
    const getValue = column.sortValue || ((row) => row[column.key]);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
    if (sort.dir === "desc") copy.reverse();
    return copy;
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  };

  const allFilteredSelected = sorted.length > 0 && sorted.every((row) => selected.has(rowKey(row)));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allFilteredSelected) return new Set();
      return new Set(sorted.map(rowKey));
    });
  };

  const toggleSelectRow = (row) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedRows = rows.filter((row) => selected.has(rowKey(row)));

  const handleFilterChange = (key, value) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  if (loading) {
    return (
      <div className="ui-data-table-wrap">
        <TableToolbar title={title} count={rows.length} />
        <LoadingSkeleton variant="table" rows={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ui-data-table-wrap">
        <TableToolbar title={title} count={rows.length} />
        <ErrorState description={error} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="ui-data-table-wrap">
      <TableToolbar
        title={title}
        count={rows.length}
        search={searchFn ? { value: query, onChange: (v) => { setQuery(v); setPage(1); }, placeholder: searchPlaceholder } : null}
        filters={filters ? { filters: filters.filters, values: filterValues, onChange: handleFilterChange, onClear: () => { setFilterValues({}); setPage(1); } } : null}
        actions={toolbarActions}
        selectedCount={selected.size}
        bulkActions={bulkActions?.map((action) => ({
          ...action,
          onClick: () => action.onClick(selectedRows),
        }))}
        onClearSelection={() => setSelected(new Set())}
      />

      {sorted.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="ui-data-table-scroll">
            <table className="admin-table ui-data-table">
              <thead>
                <tr>
                  {bulkActions && (
                    <th className="ui-data-table-checkbox-col">
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      style={column.width ? { width: column.width } : undefined}
                      className={column.sortable ? "ui-data-table-sortable" : undefined}
                    >
                      {column.sortable ? (
                        <button type="button" onClick={() => toggleSort(column.key)}>
                          {column.header}
                          <span className="material-symbols-outlined" aria-hidden="true">
                            {sort.key === column.key
                              ? sort.dir === "asc" ? "arrow_upward" : "arrow_downward"
                              : "unfold_more"}
                          </span>
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  ))}
                  {rowActions && <th className="ui-data-table-actions-col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const key = rowKey(row);
                  const actions = rowActions?.(row) || [];
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={onRowClick ? "ui-data-table-row-clickable" : undefined}
                    >
                      {bulkActions && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select row ${key}`}
                            checked={selected.has(key)}
                            onChange={() => toggleSelectRow(row)}
                          />
                        </td>
                      )}
                      {columns.map((column) => (
                        <td key={column.key} style={column.align ? { textAlign: column.align } : undefined}>
                          {column.render ? column.render(row) : row[column.key]}
                        </td>
                      ))}
                      {rowActions && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="admin-row-actions">
                            {actions.map((action) => (
                              <button
                                key={action.label}
                                type="button"
                                className={action.danger ? "danger" : undefined}
                                onClick={action.onClick}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            pageCount={pageCount}
            totalItems={sorted.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
};

export default DataTable;
