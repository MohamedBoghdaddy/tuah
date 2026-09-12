/**
 * Groups related fields inside a form with a heading + optional description,
 * replacing ad hoc headings dropped directly between .admin-field blocks.
 */
const FormSection = ({ title, description, children, columns = 2 }) => (
  <section className="ui-form-section">
    {title && (
      <div className="ui-form-section-header">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
    )}
    <div
      className={`admin-form-grid${columns !== 2 ? ` ui-form-grid-cols-${columns}` : ""}`}
    >
      {children}
    </div>
  </section>
);

export default FormSection;
