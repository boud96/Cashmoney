// The dashboard's action dialogs (recategorize, bulk assign, transfers, uncategorized review) and the recategorize result.
import { useMemo } from "react";

import { LoadingButton, ModalShell, TagToggleList } from "../../components.jsx";
import {
  formatAmountWithCurrency,
  formatAmountValue,
  formatCount,
  formatDateTime,
  pluralize,
  subLabel,
  titleCase,
  wniOptions,
} from "../../shared.js";

export const emptyKeywordDraft = {
  name: "",
  include_terms: "",
  exclude_terms: "",
  subcategory_id: "",
  want_need_investment: "",
  tag_ids: [],
  priority: 0,
  is_ignored: false,
};

export const NO_BULK_CHANGE = "__no_change__";

export const CLEAR_BULK_VALUE = "__clear__";

export const emptyBulkAssignDraft = {
  subcategory: NO_BULK_CHANGE,
  tagMode: "no_change",
  tagIds: [],
  wantNeedInvestment: NO_BULK_CHANGE,
  ignored: NO_BULK_CHANGE,
  locked: NO_BULK_CHANGE,
};

export function keywordDraftFromSuggestion(suggestion) {
  if (!suggestion) {
    return { ...emptyKeywordDraft, tag_ids: [] };
  }
  const keyword = suggestion.suggested_keyword || {};
  return {
    name: keyword.name || "",
    include_terms: (keyword.include_terms || []).join("\n"),
    exclude_terms: (keyword.exclude_terms || []).join("\n"),
    subcategory_id: "",
    want_need_investment: "",
    tag_ids: [],
    priority: keyword.priority ?? 0,
    is_ignored: Boolean(keyword.is_ignored),
  };
}

export function textLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function RecategorizeModal({
  busy,
  count,
  includeLocked,
  onClose,
  onIncludeLockedChange,
  onSubmit,
}) {
  return (
    <ModalShell
      className="recategorize-modal"
      closeDisabled={busy}
      closeLabel="Close recategorize modal"
      description="This will rerun keyword categorization for the current filtered scope. Locked transactions are skipped unless included here."
      onClose={onClose}
      title="Recategorize"
      titleId="recategorize-modal-title"
    >
        <div className="bulk-assign-warning">
          Current filters show {pluralize(count, "transaction")}.
        </div>
        <label className="check-row recategorize-modal-toggle">
          <input checked={includeLocked} disabled={busy} onChange={(event) => onIncludeLockedChange(event.target.checked)} type="checkbox" />
          <span>Include locked transactions</span>
        </label>
        {includeLocked && (
          <div className="recategorize-locked-warning">
            Locked transactions may contain manual corrections. Recategorizing them can overwrite subcategory, WNI, tags, ignored state, and refreshed mapped fields.
          </div>
        )}
        <div className="bulk-assign-modal-actions">
          <button className="link-button" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <LoadingButton busy={busy} busyLabel="Recategorizing" className="primary-action" onClick={onSubmit} type="button">
            Recategorize
          </LoadingButton>
        </div>
    </ModalShell>
  );
}

export function BulkAssignMultiModal({
  booleanOptions,
  busy,
  count,
  draft,
  hasChanges,
  onClose,
  onSubmit,
  onTagToggle,
  onUpdate,
  subcategoryOptions,
  tags,
  wniOptions,
}) {
  const tagSelectionDisabled = !["add", "replace"].includes(draft.tagMode);
  return (
    <ModalShell
      className="bulk-assign-modal"
      closeDisabled={busy}
      closeLabel="Close bulk assign modal"
      description={`This will update ${pluralize(count, "currently filtered transaction")}. Subcategory, tags, WNI, or ignored changes will lock categorization unless you explicitly set Locked to No.`}
      onClose={onClose}
      title="Bulk assign"
      titleId="bulk-assign-modal-title"
    >
        <div className="bulk-assign-form">
          <label className="form-field">
            <span>Subcategory</span>
            <select autoFocus disabled={busy} onChange={(event) => onUpdate({ subcategory: event.target.value })} value={draft.subcategory}>
              {subcategoryOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>WNI</span>
            <select disabled={busy} onChange={(event) => onUpdate({ wantNeedInvestment: event.target.value })} value={draft.wantNeedInvestment}>
              {wniOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Ignored</span>
            <select disabled={busy} onChange={(event) => onUpdate({ ignored: event.target.value })} value={draft.ignored}>
              {booleanOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Locked</span>
            <select disabled={busy} onChange={(event) => onUpdate({ locked: event.target.value })} value={draft.locked}>
              {booleanOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field bulk-tag-mode-field">
            <span>Tags</span>
            <select disabled={busy} onChange={(event) => onUpdate({ tagMode: event.target.value })} value={draft.tagMode}>
              <option value="no_change">No change</option>
              <option value="add">Add selected tags</option>
              <option value="replace">Replace with selected tags</option>
              <option value="clear">Clear all tags</option>
            </select>
          </label>
          <div className={`bulk-tag-picker ${tagSelectionDisabled ? "is-disabled" : ""}`.trim()}>
            <TagToggleList
              disabled={busy || tagSelectionDisabled}
              emptyText="No tags defined"
              label="Tags"
              onToggle={onTagToggle}
              tags={tags}
              value={draft.tagIds}
            />
          </div>
        </div>
        <div className="bulk-assign-modal-actions">
          <button className="link-button" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <LoadingButton busy={busy} busyLabel="Assigning" className="primary-action" disabled={!hasChanges} onClick={onSubmit} type="button">
            Apply
          </LoadingButton>
        </div>
    </ModalShell>
  );
}

export function InternalTransferReviewPanel({
  applying,
  busy,
  candidates,
  dateTolerance,
  error,
  hideAmounts,
  includeIgnored,
  includeLocked,
  matches,
  matchesBusy,
  meta,
  onApply,
  onClose,
  onDateToleranceChange,
  onIncludeIgnoredChange,
  onIncludeLockedChange,
  onSubcategoryChange,
  onToggleCandidate,
  onUnmatch,
  onViewChange,
  selectedIds,
  subcategoryId,
  subcategoryOptions,
  unmatchingId,
  view,
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const showingMatched = view === "matched";
  const matchList = matches.matches || [];
  return (
    <ModalShell
      className="transfer-review-modal"
      closeDisabled={applying || Boolean(unmatchingId)}
      closeLabel="Close transfer review"
      description="Find matching outgoing and incoming transactions across your accounts in the current filter scope, or review and undo pairs already matched."
      headerClassName="transfer-review-modal-header"
      onClose={onClose}
      title="Find transfers"
      titleId="transfer-review-title"
    >
        <div className="transfer-review-layout">
          <div className="transfer-view-switch" role="group" aria-label="Transfer view">
            <button aria-pressed={!showingMatched} className={`link-button ${showingMatched ? "" : "is-active"}`.trim()} disabled={applying} onClick={() => onViewChange("candidates")} type="button">
              Candidates
            </button>
            <button aria-pressed={showingMatched} className={`link-button ${showingMatched ? "is-active" : ""}`.trim()} disabled={applying} onClick={() => onViewChange("matched")} type="button">
              Matched
            </button>
          </div>
          {showingMatched ? (
            <div className="bulk-assign-warning transfer-review-summary">
              {formatCount(matches.count)} matched {matches.count === 1 ? "transfer" : "transfers"} in the current filter scope.
              {matches.count > matchList.length ? ` Showing the newest ${formatCount(matchList.length)}.` : ""}
            </div>
          ) : (
            <>
              <div className="bulk-assign-warning transfer-review-summary">
                {pluralize(meta.count, "candidate")}. {formatCount(meta.high_confidence_count)} high confidence, {formatCount(meta.ambiguous_count)} ambiguous.
              </div>
              <div className="transfer-review-controls">
                <label className="form-field">
                  <span>Date offset</span>
                  <input
                    min="0"
                    max="14"
                    onChange={(event) => onDateToleranceChange(Number(event.target.value || 0))}
                    type="number"
                    value={dateTolerance}
                  />
                </label>
                <label className="check-row">
                  <input checked={includeIgnored} onChange={(event) => onIncludeIgnoredChange(event.target.checked)} type="checkbox" />
                  <span>Include ignored</span>
                </label>
                <label className="check-row">
                  <input checked={includeLocked} onChange={(event) => onIncludeLockedChange(event.target.checked)} type="checkbox" />
                  <span>Include locked</span>
                </label>
              </div>
            </>
          )}
          {error && <div className="transfer-review-error">{error}</div>}
          {showingMatched ? (
            <div className="transfer-candidate-list">
              {matchesBusy && !matchList.length ? (
                <div className="transfer-empty-state">Loading matched transfers</div>
              ) : matchList.length ? (
                matchList.map((match) => (
                  <InternalTransferMatchCard
                    busy={unmatchingId === match.id}
                    disabled={Boolean(unmatchingId)}
                    hideAmounts={hideAmounts}
                    key={match.id}
                    match={match}
                    onUnmatch={() => onUnmatch(match)}
                  />
                ))
              ) : (
                <div className="transfer-empty-state">No matched transfers in the current filter scope.</div>
              )}
            </div>
          ) : (
            <>
              <div className="transfer-candidate-list">
                {busy && !candidates.length ? (
                  <div className="transfer-empty-state">Scanning filtered transactions</div>
                ) : candidates.length ? (
                  candidates.map((candidate) => (
                    <InternalTransferCandidateCard
                      candidate={candidate}
                      checked={selectedSet.has(candidate.id)}
                      hideAmounts={hideAmounts}
                      key={candidate.id}
                      onToggle={() => onToggleCandidate(candidate.id)}
                    />
                  ))
                ) : (
                  <div className="transfer-empty-state">No transfer candidates found in the current filter scope.</div>
                )}
              </div>
              <div className="transfer-review-actions">
                <span>{formatCount(selectedIds.length)} selected</span>
                <label className="transfer-apply-subcategory">
                  <span>Subcategory</span>
                  <select disabled={applying} onChange={(event) => onSubcategoryChange(event.target.value)} value={subcategoryId}>
                    {subcategoryOptions.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
                  </select>
                </label>
                <LoadingButton busy={applying} busyLabel="Applying" className="primary-action transfer-apply-button" disabled={!selectedIds.length || busy} onClick={onApply} type="button">
                  Apply
                </LoadingButton>
              </div>
            </>
          )}
        </div>
    </ModalShell>
  );
}

function InternalTransferMatchCard({ busy, disabled, hideAmounts, match, onUnmatch }) {
  return (
    <div className="transfer-candidate-card transfer-match-card">
      <div className="transfer-candidate-body">
        <div className="transfer-candidate-header">
          <strong>Matched {formatDateTime(match.created_at)}</strong>
          <LoadingButton busy={busy} busyLabel="Unmatching" className="link-button transfer-unmatch-button" disabled={disabled} onClick={onUnmatch} type="button">
            Unmatch
          </LoadingButton>
        </div>
        <div className="transfer-pair-grid">
          <TransferTransactionSummary label="Outgoing" transaction={match.outgoing} hideAmounts={hideAmounts} />
          <TransferTransactionSummary label="Incoming" transaction={match.incoming} hideAmounts={hideAmounts} />
        </div>
      </div>
    </div>
  );
}

function InternalTransferCandidateCard({ candidate, checked, hideAmounts, onToggle }) {
  return (
    <label className={`transfer-candidate-card ${checked ? "is-selected" : ""}`.trim()}>
      <input checked={checked} onChange={onToggle} type="checkbox" />
      <div className="transfer-candidate-body">
        <div className="transfer-candidate-header">
          <strong>{titleCase(candidate.confidence_level)} confidence</strong>
        </div>
        <div className="transfer-pair-grid">
          <TransferTransactionSummary label="Outgoing" transaction={candidate.outgoing} hideAmounts={hideAmounts} />
          <TransferTransactionSummary label="Incoming" transaction={candidate.incoming} hideAmounts={hideAmounts} />
        </div>
        <div className="transfer-reason-list">
          {(candidate.match_reasons || []).map((reason) => {
            const reasonLabel = typeof reason === "string" ? reason : reason.label;
            const reasonTone = typeof reason === "string" ? "" : reason.tone;
            return <span className={reasonTone ? `is-${reasonTone}` : ""} key={reasonLabel}>{reasonLabel}</span>;
          })}
        </div>
      </div>
    </label>
  );
}

function TransferTransactionSummary({ hideAmounts, label, transaction }) {
  return (
    <div className="transfer-transaction-summary">
      <div>
        <strong>{label}</strong>
        <span>{transaction.bank_account?.name || "No account"}</span>
      </div>
      <div className="transfer-transaction-main">
        <span>{transaction.transaction_date}</span>
        <strong>{formatAmountWithCurrency(transaction.amount, transaction.currency, hideAmounts)}</strong>
      </div>
      <p>{transaction.description || transaction.counterparty_name || "No description"}</p>
      {transaction.counterparty_account_number ? <span className="muted">{transaction.counterparty_account_number}</span> : null}
    </div>
  );
}

export function UncategorizedReviewPanel({
  busy,
  defaultCurrency,
  draft,
  error,
  hideAmounts,
  meta,
  onClearError,
  onCreateKeyword,
  onCreateKeywordAndApply,
  onClose,
  onDraftChange,
  onSelectSuggestion,
  refs,
  selectedSuggestion,
  submitting,
  suggestions,
}) {
  function updateDraft(patch) {
    onClearError();
    onDraftChange((current) => ({ ...current, ...patch }));
  }

  function toggleTag(tagId) {
    onClearError();
    onDraftChange((current) => {
      const selectedTags = new Set(current.tag_ids || []);
      if (selectedTags.has(tagId)) {
        selectedTags.delete(tagId);
      } else {
        selectedTags.add(tagId);
      }
      return { ...current, tag_ids: [...selectedTags] };
    });
  }

  return (
    <ModalShell
      className="uncategorized-review-modal"
      closeDisabled={Boolean(submitting)}
      closeLabel="Close uncategorized review"
      description="Review uncategorized transaction groups and create a keyword rule from the selected suggestion."
      headerClassName="uncategorized-review-modal-header"
      onClose={onClose}
      title="Review uncategorized"
      titleId="uncategorized-review-title"
    >
        <div className="uncategorized-review-layout">
          <div className="bulk-assign-warning uncategorized-review-summary">
            {pluralize(meta.transaction_count, "transaction")} in{" "}
            {pluralize(meta.count, "group")}
          </div>
          {error ? <div className="uncategorized-review-error">{error}</div> : null}
          <div className="uncategorized-suggestion-list">
          {busy && !suggestions.length ? (
            <div className="uncategorized-empty-state">Loading suggestions...</div>
          ) : suggestions.length ? (
            suggestions.map((suggestion) => (
              <button
                className={`uncategorized-suggestion-card ${
                  selectedSuggestion?.id === suggestion.id ? "is-active" : ""
                }`}
                key={suggestion.id}
                onClick={() => onSelectSuggestion(suggestion)}
                type="button"
              >
                <span className="suggestion-card-title">{suggestion.sample_description}</span>
                <span className="suggestion-card-meta">
                  {suggestion.reason} | {pluralize(suggestion.transaction_count, "transaction")}
                </span>
                <span className="suggestion-card-amount">
                  {formatAmountWithCurrency(
                    suggestion.total_amount,
                    suggestion.currency || defaultCurrency,
                    hideAmounts,
                  )}
                </span>
              </button>
            ))
          ) : (
            <div className="uncategorized-empty-state">
              No uncategorized suggestions for the current filters.
            </div>
          )}
        </div>

          <div className="uncategorized-detail-panel">
          {selectedSuggestion ? (
            <>
              <div className="uncategorized-detail-header">
                <div>
                  <h3>{selectedSuggestion.sample_description}</h3>
                  <span>{selectedSuggestion.date_from} - {selectedSuggestion.date_to}</span>
                </div>
                <strong>
                  {formatAmountWithCurrency(
                    selectedSuggestion.total_amount,
                    selectedSuggestion.currency || defaultCurrency,
                    hideAmounts,
                  )}
                </strong>
              </div>
              <div className="uncategorized-keyword-form">
                <label className="form-field">
                  <span>Keyword name</span>
                  <input
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    type="text"
                    value={draft.name}
                  />
                </label>
                <label className="form-field">
                  <span>Include terms</span>
                  <textarea
                    onChange={(event) => updateDraft({ include_terms: event.target.value })}
                    rows="3"
                    value={draft.include_terms}
                  />
                </label>
                <label className="form-field">
                  <span>Exclude terms</span>
                  <textarea
                    onChange={(event) => updateDraft({ exclude_terms: event.target.value })}
                    rows="3"
                    value={draft.exclude_terms}
                  />
                </label>
                <label className="form-field">
                  <span>Subcategory</span>
                  <select
                    onChange={(event) => updateDraft({ subcategory_id: event.target.value })}
                    value={draft.subcategory_id}
                  >
                    <option value="">No subcategory</option>
                    {refs.subcategories.map((item) => (
                      <option key={item.id} value={item.id}>{subLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>WNI</span>
                  <select
                    onChange={(event) => updateDraft({ want_need_investment: event.target.value })}
                    value={draft.want_need_investment}
                  >
                    <option value="">No WNI</option>
                    {wniOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <input
                    onChange={(event) => updateDraft({ priority: event.target.value })}
                    type="number"
                    value={draft.priority}
                  />
                </label>
                <div className="uncategorized-tag-field">
                  <span>Tags</span>
                  <TagToggleList label="Tags" onToggle={toggleTag} tags={refs.tags} value={draft.tag_ids || []} />
                </div>
                <label className="check-row uncategorized-ignore-row">
                  <input
                    checked={draft.is_ignored}
                    onChange={(event) => updateDraft({ is_ignored: event.target.checked })}
                    type="checkbox"
                  />
                  <span>Ignore matches</span>
                </label>
              </div>
              <div className="uncategorized-sample-table">
                <div className="uncategorized-sample-header">
                  <span>Sample transactions</span>
                  <span>{formatCount(selectedSuggestion.transaction_count)} total</span>
                </div>
                {selectedSuggestion.sample_transactions.map((transaction) => (
                  <div className="uncategorized-sample-row" key={transaction.id}>
                    <span>{transaction.transaction_date}</span>
                    <span>{transaction.description}</span>
                    <strong>
                      {formatAmountWithCurrency(
                        transaction.converted_amount ?? transaction.amount,
                        transaction.converted_currency || transaction.currency || defaultCurrency,
                        hideAmounts,
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="uncategorized-review-actions">
                <LoadingButton
                  busy={submitting === "create"}
                  busyLabel="Creating"
                  className="link-button"
                  disabled={Boolean(submitting)}
                  onClick={onCreateKeyword}
                  type="button"
                >
                  Create Keyword
                </LoadingButton>
                <LoadingButton
                  busy={submitting === "create-apply"}
                  busyLabel="Applying"
                  className="primary-action"
                  disabled={Boolean(submitting)}
                  onClick={onCreateKeywordAndApply}
                  type="button"
                >
                  Create & Apply
                </LoadingButton>
              </div>
            </>
          ) : (
            <div className="uncategorized-empty-state">Choose a suggestion</div>
          )}
          </div>
        </div>
    </ModalShell>
  );
}

export function RecategorizeStats({ result }) {
  const conflictDetails = result.conflict_details || [];
  const metrics = [
    {
      label: "Processed",
      value: result.processed,
    },
    {
      ids: result.updated_transaction_ids || [],
      label: "Updated",
      transactions: result.updated_transactions || [],
      value: result.updated,
    },
    {
      ids: result.unchanged_transaction_ids || [],
      label: "Unchanged",
      transactions: result.unchanged_transactions || [],
      value: result.unchanged,
    },
    {
      ids: result.uncategorized_transaction_ids || [],
      label: "Uncategorized",
      transactions: result.uncategorized_transactions || [],
      value: result.uncategorized,
    },
    {
      details: <ConflictDetailList details={conflictDetails} total={result.conflicts} />,
      detailCount: conflictDetails.length,
      label: "Conflicts",
      value: result.conflicts,
    },
    {
      ids: result.skipped_transaction_ids || [],
      label: "Skipped",
      transactions: result.skipped_transactions || [],
      value: result.skipped_no_mapping,
    },
    {
      ids: result.skipped_locked_transaction_ids || [],
      label: "Skipped locked",
      transactions: result.skipped_locked_transactions || [],
      value: result.skipped_locked,
    },
  ];
  return (
    <div className="recategorize-stats">
      {metrics.map((metric) => (
        <RecategorizeMetric key={metric.label} metric={metric} />
      ))}
    </div>
  );
}

function RecategorizeMetric({ metric }) {
  const count = Number(metric.value || 0);
  const ids = metric.ids || [];
  const transactions = metric.transactions || [];
  // The lists are samples (up to 40 rows); count is the whole group.
  const hasDetails = Boolean(metric.detailCount ?? (transactions.length || ids.length));
  return (
    <div className={`metric recategorize-metric${hasDetails ? " metric-has-details" : ""}`}>
      <div className="metric-label">{metric.label}</div>
      <div className="metric-value">{formatCount(count)}</div>
      {hasDetails ? (
        <details className="metric-details">
          <summary>{formatCount(count)} details</summary>
          {metric.details || (transactions.length ? <TransactionSummaryList total={count} transactions={transactions} /> : <TransactionIdList ids={ids} total={count} />)}
        </details>
      ) : (
        <div className="metric-empty-detail">No details</div>
      )}
    </div>
  );
}

function TransactionIdList({ ids, total = ids.length }) {
  const visibleIds = ids.slice(0, 40);
  const hidden = Math.max(total, ids.length) - visibleIds.length;
  return (
    <div className="metric-id-list">
      {visibleIds.map((id) => <code key={id}>{id}</code>)}
      {hidden > 0 ? <span className="muted">+{formatCount(hidden)} more</span> : null}
    </div>
  );
}

function TransactionSummaryList({ total = 0, transactions }) {
  const visibleTransactions = transactions.slice(0, 40);
  const hidden = Math.max(total, transactions.length) - visibleTransactions.length;
  return (
    <div className="metric-transaction-list">
      {visibleTransactions.map((transaction) => (
        <div className="metric-transaction" key={transaction.id}>
          <div className="metric-transaction-main">
            <strong>{transaction.transaction_date}</strong>
            <span>{formatAmountValue(transaction.amount, false)}</span>
          </div>
          <div className="metric-transaction-description">
            {transaction.description || "No description"}
          </div>
          {transaction.bank_account?.name ? (
            <div className="metric-transaction-account">{transaction.bank_account.name}</div>
          ) : null}
        </div>
      ))}
      {hidden > 0 ? <span className="muted">+{formatCount(hidden)} more</span> : null}
    </div>
  );
}

function ConflictDetailList({ details, total = 0 }) {
  if (!details.length) {
    return null;
  }
  const visibleDetails = details.slice(0, 20);
  const hidden = Math.max(total, details.length) - visibleDetails.length;
  return (
    <div className="conflict-detail-list">
      {visibleDetails.map((detail) => (
        <article className="conflict-detail" key={detail.transaction.id}>
          <div className="conflict-detail-title">
            <strong>{detail.transaction.transaction_date}</strong>
            <span>{detail.transaction.description}</span>
            <span>{formatAmountValue(detail.transaction.amount, false)}</span>
          </div>
          <div className="conflict-detail-reason">
            {detail.categorization.conflict_reason || "Top-priority keyword results differ."}
          </div>
          <KeywordMatchList matches={detail.categorization.top_matched_keywords || []} />
        </article>
      ))}
      {hidden > 0 ? <div className="muted">+{pluralize(hidden, "more conflict")}</div> : null}
    </div>
  );
}

function KeywordMatchList({ matches }) {
  if (!matches?.length) {
    return <div className="muted">No keyword matches</div>;
  }
  return (
    <div className="keyword-match-list">
      {matches.map((match) => (
        <div className="keyword-match" key={match.id}>
          <div>
            <strong>{match.name}</strong>
            <span className="muted">Priority {match.priority}</span>
          </div>
          <div className="keyword-match-target">
            {match.subcategory ? `${match.category?.name || "Uncategorized"} / ${match.subcategory.name}` : "No subcategory"}
            {match.want_need_investment ? ` - ${titleCase(match.want_need_investment)}` : ""}
            {match.is_ignored ? " - Ignored" : ""}
          </div>
          <div className="keyword-match-terms">
            <span>Include: {(match.include_terms || []).join(", ") || "none"}</span>
            {(match.exclude_terms || []).length ? <span>Exclude: {match.exclude_terms.join(", ")}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
