import { useEffect, useId, useLayoutEffect, useRef } from "react";

const modalStack = [];

export function Select({ blank, defaultValue = "", name, onChange, options, required = false, value }) {
  const controlledProps = value === undefined ? { defaultValue } : { value };
  return (
    <select {...controlledProps} name={name} onChange={onChange} required={required}>
      {blank && <option value="">{blank}</option>}
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

export function LoadingButton({ busy = false, busyLabel = "Working", children, className = "", disabled = false, onClick, type, ...props }) {
  // A busy button stays focusable (aria-disabled, clicks ignored) instead of disabled:
  // a disabled button drops focus to the page, so focus couldn't return to it when a
  // dialog it opened closes. A busy submit button stays disabled, because Enter in its
  // form would submit again.
  const keepsFocus = busy && type !== "submit";
  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      aria-disabled={keepsFocus || undefined}
      className={`${className} ${busy ? "is-loading" : ""}`.trim()}
      disabled={keepsFocus ? false : disabled || busy}
      onClick={keepsFocus ? undefined : onClick}
      type={type}
    >
      {busy && <Spinner />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="loading-spinner" />;
}

export function Metric({ label, tone = "", value }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className={`metric-value ${tone}`}>{value}</div></div>;
}

export function HelpTooltip({ text }) {
  return (
    <span className="help-tooltip">
      <button aria-label={text} className="help-tooltip-button" type="button">?</button>
      <span className="help-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

export function CloseButton({ className = "", label = "Close", ...props }) {
  return (
    <button {...props} aria-label={label} className={`icon-button ${className}`.trim()} type="button">
      x
    </button>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => element.getClientRects().length > 0);
}

// Where focus goes when a dialog opens: the given element; else the dialog itself when
// it is focusable (tabIndex -1); else its first field, skipping the header's close button.
function initialFocusTarget(dialog, initialFocusRef) {
  if (initialFocusRef?.current) {
    return initialFocusRef.current;
  }
  if (dialog.hasAttribute("tabindex")) {
    return dialog;
  }
  const elements = focusableElements(dialog);
  return elements.find((element) => !element.classList.contains("icon-button")) || elements[0] || null;
}

// The topmost open dialog owns the keyboard: Escape closes it, Tab and Shift+Tab wrap
// around inside it. Focus moves into a dialog when it opens and returns to where it was
// (usually the button that opened it) when it closes.
function useModalBehavior(onClose, { closeDisabled = false, dialogRef, initialFocusRef } = {}) {
  const modalIdRef = useRef(Symbol("modal"));
  // Read during the first render: effects run children first, and dialog content may
  // already have focused one of its fields by the time this hook's effect runs.
  const previousFocusRef = useRef(undefined);
  if (previousFocusRef.current === undefined) {
    previousFocusRef.current = document.activeElement;
  }

  useEffect(() => {
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    const previousFocus = previousFocusRef.current;
    const dialog = dialogRef?.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      initialFocusTarget(dialog, initialFocusRef)?.focus({ preventScroll: true });
    }
    return () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
      const active = document.activeElement;
      const focusLeftWithDialog = !active || active === document.body || Boolean(dialog?.contains(active));
      if (focusLeftWithDialog && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const modalId = modalIdRef.current;
    function handleKeyDown(event) {
      if (modalStack[modalStack.length - 1] !== modalId) {
        return;
      }
      if (event.key === "Escape") {
        if (!closeDisabled) {
          event.preventDefault();
          onClose?.();
        }
        return;
      }
      const dialog = dialogRef?.current;
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      const elements = focusableElements(dialog);
      const active = document.activeElement;
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!dialog.contains(active) || active === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, dialogRef, initialFocusRef, onClose]);
}

// For dialogs rendered conditionally inside an always-mounted component: render this
// next to the open dialog element (in the same backdrop) for Escape and focus handling.
export function ModalEscape({ onClose }) {
  const markerRef = useRef(null);
  const dialogRef = useRef(null);
  useLayoutEffect(() => {
    dialogRef.current = markerRef.current?.parentElement?.querySelector("[role='dialog']") || null;
  }, []);
  useModalBehavior(onClose, { dialogRef });
  return <span hidden ref={markerRef} />;
}

export function ModalShell({
  children,
  className = "",
  closeDisabled = false,
  closeLabel = "Close",
  description = "",
  headerClassName = "",
  onClose,
  title,
  titleId,
}) {
  const generatedTitleId = useId();
  const dialogTitleId = titleId || generatedTitleId;
  const dialogRef = useRef(null);

  useModalBehavior(onClose, { closeDisabled, dialogRef });

  function closeFromBackdrop(event) {
    if (event.target === event.currentTarget && !closeDisabled) {
      onClose?.();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeFromBackdrop} role="presentation">
      <div
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className={className}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className={`action-modal-header ${headerClassName}`.trim()}>
          <div className="action-modal-title-block">
            <h2 id={dialogTitleId}>{title}</h2>
            {description ? <p className="action-modal-description">{description}</p> : null}
          </div>
          <CloseButton disabled={closeDisabled} label={closeLabel} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  danger = false,
  message,
  onCancel,
  onConfirm,
  title = "Confirm Action",
}) {
  const cancelButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const titleId = useId();

  useModalBehavior(onCancel, { dialogRef, initialFocusRef: cancelButtonRef });

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
      role="presentation"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`confirm-modal ${danger ? "is-danger" : ""}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="confirm-modal-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="confirm-modal-message">{message}</div>
        <div className="confirm-modal-actions">
          <button className="link-button" onClick={onCancel} ref={cancelButtonRef} type="button">
            {cancelLabel}
          </button>
          <button className={danger ? "danger-button" : "primary-action"} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
