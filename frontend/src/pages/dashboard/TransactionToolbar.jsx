import { LoadingButton, Spinner } from "../../components.jsx";

// The actions on the filtered transactions, above the table. Delete sits apart, in red.
export function TransactionToolbar({
  actionsDisabled,
  busy = false,
  countLabel,
  deleting = false,
  findingTransfers = false,
  loadingReview = false,
  onBulkAssign,
  onDelete,
  onFindTransfers,
  onRecategorize,
  onReview,
  recategorizing = false,
  reviewDisabled = false,
}) {
  return (
    <div aria-label="Actions on the filtered transactions" className="transaction-toolbar" role="toolbar">
      <span className="transaction-toolbar-status">
        {busy ? <Spinner /> : null}
        <span className="transaction-toolbar-count">{countLabel}</span>
      </span>
      <LoadingButton busy={recategorizing} busyLabel="Recategorizing" className="link-button" disabled={actionsDisabled} onClick={onRecategorize} type="button">
        Recategorize
      </LoadingButton>
      <button className="link-button" disabled={actionsDisabled} onClick={onBulkAssign} type="button">
        Bulk assign
      </button>
      <LoadingButton busy={findingTransfers} busyLabel="Scanning" className="link-button" disabled={actionsDisabled} onClick={onFindTransfers} type="button">
        Find transfers
      </LoadingButton>
      <LoadingButton busy={loadingReview} busyLabel="Loading" className="link-button" disabled={reviewDisabled} onClick={onReview} type="button">
        Review uncategorized
      </LoadingButton>
      <LoadingButton busy={deleting} busyLabel="Checking" className="link-button danger-link transaction-toolbar-delete" disabled={actionsDisabled} onClick={onDelete} type="button">
        Delete filtered…
      </LoadingButton>
    </div>
  );
}
