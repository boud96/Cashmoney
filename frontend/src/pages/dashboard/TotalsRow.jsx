// The dashboard's one row of totals (income, expenses, net, counts), from the summary.
export function TotalsRow({ busy = false, onReview, reviewDisabled = false, totals }) {
  return (
    <section aria-busy={busy || undefined} aria-label="Totals" className={`totals-row ${busy ? "is-busy" : ""}`.trim()}>
      {totals.map((total) => (
        <div className={`total total-${total.key}`} key={total.key}>
          <div className="total-label">{total.label}</div>
          <div className={`total-value ${total.tone}`.trim()}>{total.value}</div>
          {total.key === "uncategorized" ? (
            <button className="text-button total-detail" disabled={reviewDisabled} onClick={onReview} type="button">
              Review →
            </button>
          ) : (
            <div className="total-detail">{total.detail}</div>
          )}
        </div>
      ))}
    </section>
  );
}
