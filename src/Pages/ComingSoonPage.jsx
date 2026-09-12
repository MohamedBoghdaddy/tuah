import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminShell } from "../Components/AdminShell";

/**
 * Honest placeholder for ERP taxonomy items that don't have a backend yet
 * (Inventory, Purchasing, Manufacturing, Operations, Finance, etc.). No
 * fabricated stats or sample records — just an acknowledgement of where the
 * module sits in the roadmap and a way back to something real.
 */
const ComingSoonPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const moduleLabel = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("module") || "This module";
  }, [location.search]);

  const [groupLabel, itemLabel] = moduleLabel.split(" · ");

  return (
    <AdminShell
      active={itemLabel || moduleLabel}
      title={itemLabel || moduleLabel}
      subtitle={groupLabel ? `${groupLabel} · roadmap` : "Roadmap"}
      breadcrumbs={[
        { label: "Tuah OS", href: "/admin/dashboard" },
        ...(groupLabel ? [{ label: groupLabel }] : []),
        { label: itemLabel || moduleLabel },
      ]}
    >
      <div className="admin-coming-soon">
        <span className="material-symbols-outlined">construction</span>
        <h2>{itemLabel || moduleLabel} is coming next</h2>
        <p>
          This part of the Tuah ERP taxonomy is on the build roadmap but doesn't have a
          working backend yet. It isn't hidden — you can see where it sits in the
          navigation — but there's no data to show here honestly, so nothing is faked.
        </p>
        <button type="button" className="admin-premium-button primary" onClick={() => navigate("/admin/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    </AdminShell>
  );
};

export default ComingSoonPage;
