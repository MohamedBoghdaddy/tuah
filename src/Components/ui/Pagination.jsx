/**
 * Minimal page-number pagination. Controlled component — parent owns `page`.
 * `page` is 1-indexed.
 */
const Pagination = ({ page, pageCount, totalItems, pageSize, onPageChange }) => {
  if (pageCount <= 1) return null;

  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  const goTo = (p) => {
    const clamped = Math.min(Math.max(p, 1), pageCount);
    if (clamped !== page) onPageChange(clamped);
  };

  return (
    <nav className="ui-pagination" aria-label="Pagination">
      <span className="ui-pagination-summary">
        {totalItems === 0 ? "No results" : `${from}–${to} of ${totalItems}`}
      </span>
      <div className="ui-pagination-controls">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="ui-pagination-page" aria-current="page">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
    </nav>
  );
};

export default Pagination;
