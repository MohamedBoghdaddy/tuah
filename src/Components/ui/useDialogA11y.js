import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared accessibility wiring for modal-like surfaces (ConfirmDialog,
 * DetailDrawer, CommandPalette): traps focus inside the container while open,
 * closes on Escape, and returns focus to whatever triggered it on close.
 *
 * Returns a ref to attach to the dialog's outermost element.
 */
export const useDialogA11y = (isOpen, onClose) => {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    triggerRef.current = document.activeElement;

    const container = containerRef.current;
    const focusables = container?.querySelectorAll(FOCUSABLE_SELECTOR);
    (focusables?.[0] || container)?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !container) return;

      const nodes = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  return containerRef;
};

export default useDialogA11y;
