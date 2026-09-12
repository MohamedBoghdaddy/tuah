import Breadcrumbs from "./Breadcrumbs";

/**
 * Standard page header used inside admin/ERP pages: breadcrumbs, title,
 * subtitle, and right-aligned contextual actions. This is the same visual
 * slot AdminShell's topbar already renders — use this component directly
 * inside a page's content area when a page needs a second, section-level
 * header (e.g. a detail view under a list), or standalone pages that don't
 * go through AdminShell's title/subtitle props.
 */
const PageHeader = ({ breadcrumbs, title, subtitle, actions }) => (
  <div className="ui-page-header">
    {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
    <div className="ui-page-header-row">
      <div>
        <h2 className="ui-page-header-title">{title}</h2>
        {subtitle && <p className="ui-page-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </div>
  </div>
);

export default PageHeader;
