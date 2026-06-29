import { useEffect, useRef } from "react";

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

export function LoadingButton({ busy = false, busyLabel = "Working", children, className = "", disabled = false, ...props }) {
  return (
    <button {...props} className={`${className} ${busy ? "is-loading" : ""}`.trim()} disabled={disabled || busy}>
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

function useModalEscape(onClose, closeDisabled = false) {
  const modalIdRef = useRef(Symbol("modal"));

  useEffect(() => {
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    return () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
    };
  }, []);

  useEffect(() => {
    const modalId = modalIdRef.current;
    function handleKeyDown(event) {
      if (event.key !== "Escape" || closeDisabled || modalStack[modalStack.length - 1] !== modalId) {
        return;
      }
      event.preventDefault();
      onClose?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, onClose]);
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
  const dialogTitleId = titleId || "modal-title";

  useModalEscape(onClose, closeDisabled);

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
        role="dialog"
      >
        <div className={`action-modal-header ${headerClassName}`.trim()}>
          <div className="action-modal-title-block">
            <h2 id={dialogTitleId}>{title}</h2>
            {description ? <p className="action-modal-description">{description}</p> : null}
          </div>
          <button aria-label={closeLabel} className="icon-button" disabled={closeDisabled} onClick={onClose} type="button">
            x
          </button>
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

  useModalEscape(onCancel);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
      role="presentation"
    >
      <div
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className={`confirm-modal ${danger ? "is-danger" : ""}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="confirm-modal-header">
          <h2 id="confirm-dialog-title">{title}</h2>
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
