/**
 * Consistent search field for table toolbars and the ERP shell's global search
 * trigger. Controlled — parent owns `value`.
 */
const SearchInput = ({ value, onChange, placeholder = "Search…", label = "Search" }) => (
  <label className="ui-search-input">
    <span className="material-symbols-outlined" aria-hidden="true">
      search
    </span>
    <input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    {value && (
      <button
        type="button"
        className="ui-search-input-clear"
        aria-label="Clear search"
        onClick={() => onChange("")}
      >
        <span className="material-symbols-outlined">close</span>
      </button>
    )}
  </label>
);

export default SearchInput;
