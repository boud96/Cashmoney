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
