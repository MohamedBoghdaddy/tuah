import { useRef } from "react";

/**
 * Accessible tab list (roving tabindex + arrow-key navigation).
 * tabs: [{ key, label, badge? }]
 */
const Tabs = ({ tabs, activeKey, onChange }) => {
  const refs = useRef({});

  const focusTab = (index) => {
    const key = tabs[(index + tabs.length) % tabs.length].key;
    refs.current[key]?.focus();
    onChange(key);
  };

  const onKeyDown = (e, index) => {
    if (e.key === "ArrowRight") { e.preventDefault(); focusTab(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); focusTab(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusTab(0); }
    else if (e.key === "End") { e.preventDefault(); focusTab(tabs.length - 1); }
  };

  return (
    <div className="ui-tabs" role="tablist">
      {tabs.map((tab, index) => {
        const isActive = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            ref={(el) => { refs.current[tab.key] = el; }}
            role="tab"
            type="button"
            id={`tab-${tab.key}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            className={`ui-tab${isActive ? " active" : ""}`}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {tab.label}
            {tab.badge != null && <span className="ui-tab-badge">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
};

/** Wrap each tab's content in this so it gets the right ARIA wiring. */
export const TabPanel = ({ tabKey, activeKey, children }) => {
  if (tabKey !== activeKey) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${tabKey}`} aria-labelledby={`tab-${tabKey}`}>
      {children}
    </div>
  );
};

export default Tabs;
