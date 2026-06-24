import { useEffect, useRef } from "react";

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

  useEffect(() => {
    cancelButtonRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

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
