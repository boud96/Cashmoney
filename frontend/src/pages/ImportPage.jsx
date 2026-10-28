import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiFetch, apiGet, readJson } from "../api.js";
import { FilePicker, LoadingButton, Spinner } from "../components.jsx";
import { TrashIcon } from "../icons.jsx";
import {
  MAX_IMPORT_FILE_BYTES,
  fileTooLargeMessage,
  formatAmountValue,
  formatCount,
  formatDateTime,
  isStatementFileFormat,
  mappingFileFormatLabel,
  pluralize,
} from "../shared.js";

// Recent imports shows the newest few; "Show all" asks for up to the API's cap.
const RECENT_IMPORT_COUNT = 8;
const ALL_IMPORTS_LIMIT = 1000;
const NO_VALUE = "–";

export default function ImportPage({ confirmAction, hideAmounts = false, importReport, notify, refs, reloadAll, reloadDashboard, setImportReport }) {
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [recentImports, setRecentImports] = useState([]);
  const [recentImportsBusy, setRecentImportsBusy] = useState(false);
  const [showAllImports, setShowAllImports] = useState(false);
  const [deletingImportId, setDeletingImportId] = useState("");
  const [reportImportId, setReportImportId] = useState("");
  const [resultScrollRequest, setResultScrollRequest] = useState(0);
  const resultRef = useRef(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const selectedAccount = useMemo(
    () => refs.accounts.find((account) => account.id === selectedAccountId) || null,
    [refs.accounts, selectedAccountId],
  );
  const defaultMapping = selectedAccount?.default_csv_mapping || null;
  // The account only names its mapping; the full mapping has the format details.
  const mappingDetails = useMemo(
    () => (defaultMapping ? refs.mappings.find((mapping) => mapping.id === defaultMapping.id) || defaultMapping : null),
    [defaultMapping, refs.mappings],
  );
  const canPreview = Boolean(selectedFile && selectedAccountId && defaultMapping && !importing && !previewing);
  const canImport = Boolean(preview && canPreview);
  const importLabel = preview ? `Import ${pluralize(newRowCount(preview.summary), "row")}` : "Import rows";

  const loadRecentImports = useCallback(async () => {
    setRecentImportsBusy(true);
    try {
      setRecentImports(await apiGet("/imports/", { limit: showAllImports ? ALL_IMPORTS_LIMIT : RECENT_IMPORT_COUNT }));
    } catch (error) {
      notify(error.message);
    } finally {
      setRecentImportsBusy(false);
    }
  }, [notify, showAllImports]);

  useEffect(() => {
    loadRecentImports();
  }, [loadRecentImports]);

  // The result area mounts with its first content, so scroll once it is there.
  useEffect(() => {
    if (resultScrollRequest) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [resultScrollRequest]);

  function setFile(file) {
    const tooLarge = fileTooLargeMessage(file, MAX_IMPORT_FILE_BYTES);
    if (tooLarge) {
      notify(tooLarge);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
    setSelectedFile(tooLarge ? null : file || null);
    setPreview(null);
    setImportReport(null);
  }

  function updateAccount(accountId) {
    setSelectedAccountId(accountId);
    setPreview(null);
    setImportReport(null);
  }

  function buildFormData() {
    const formData = new FormData();
    formData.append("bank_account_id", selectedAccountId);
    formData.append("csv_file", selectedFile);
    return formData;
  }

  async function showImportReport(item) {
    setReportImportId(item.id);
    try {
      const payload = await apiGet(`/imports/${item.id}/`);
      // One result area: the report replaces a preview; Preview brings it back.
      setPreview(null);
      setImportReport({
        ...payload.report,
        source: { filename: item.source_filename, createdAt: item.created_at },
      });
      setResultScrollRequest((count) => count + 1);
    } catch (error) {
      notify(error.message);
    } finally {
      setReportImportId("");
    }
  }

  async function deleteImport(item) {
    setDeletingImportId(item.id);
    try {
      const impact = await apiGet(`/imports/${item.id}/delete-impact/`);
      const confirmed = await confirmAction({
        confirmLabel: "Delete",
        danger: true,
        message: [
          `Delete the import of ${item.source_filename || "this file"}?`,
          ...(impact.effects || []),
          "Rows of this file that were skipped as duplicates belong to earlier imports and stay. This can't be undone.",
        ].join("\n\n"),
        title: "Delete import",
      });
      if (!confirmed) {
        return;
      }
      const result = await apiDelete(`/imports/${item.id}/`);
      notify(`Import deleted, ${pluralize(result.transactions, "transaction")} removed`);
      await Promise.all([loadRecentImports(), reloadDashboard()]);
    } catch (error) {
      notify(error.message);
    } finally {
      setDeletingImportId("");
    }
  }

  async function previewImport() {
    if (!canPreview) {
      return;
    }
    setPreviewing(true);
    try {
      const formData = buildFormData();
      formData.append("sample_size", "100");
      const response = await apiFetch("/api/imports/preview/", { method: "POST", body: formData });
      const payload = await readJson(response, "Preview failed");
      setImportReport(null);
      setPreview(payload);
      notify("Preview ready");
    } catch (error) {
      notify(error.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function submitImport(event) {
    event.preventDefault();
    if (!canImport) {
      notify("Preview the file before importing");
      return;
    }
    setImporting(true);
    try {
      const response = await apiFetch("/api/imports/", { method: "POST", body: buildFormData() });
      const payload = await readJson(response, "Import failed");
      setImportReport({
        ...payload.report,
        source: { filename: payload.import?.source_filename, createdAt: payload.import?.created_at },
      });
      setPreview(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (payload.exchange_rate_sync?.synced === false) {
        notify("Statement imported, but exchange rates need a retry");
      } else {
        notify("Statement imported");
      }
      await Promise.all([
        reloadAll(),
        reloadDashboard ? reloadDashboard() : Promise.resolve(),
        loadRecentImports(),
      ]);
    } catch (error) {
      if (error.payload?.report) {
        setPreview(null);
        setImportReport({ ...error.payload.report, source: { filename: selectedFile?.name } });
      }
      notify(error.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="import-page">
      <section className="panel import-card" aria-labelledby="import-card-title">
        <div className="panel-header">
          <h2 id="import-card-title">Import a statement <small>CSV or camt.053 XML</small></h2>
        </div>
        <form onSubmit={submitImport}>
          <fieldset className="import-steps" disabled={importing || previewing}>
            <div className="import-step">
              <label className="import-step-label" htmlFor="import-account"><span className="step-number">1</span>Bank account</label>
              <select id="import-account" onChange={(event) => updateAccount(event.target.value)} required value={selectedAccountId}>
                <option value="">Choose bank account</option>
                {refs.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              <MappingStatus account={selectedAccount} mapping={mappingDetails} />
            </div>
            <div className="import-step">
              <span className="import-step-label"><span className="step-number">2</span>Statement file</span>
              <FilePicker
                accept=".csv,.xml,text/csv,text/xml,application/xml"
                buttonLabel={selectedFile ? "Change" : "Choose…"}
                disabled={importing || previewing}
                emptyLabel="Drop a file here or click to choose one"
                file={selectedFile}
                inputRef={fileInputRef}
                label="Statement file"
                onChange={setFile}
              />
            </div>
            <div className="import-step import-step-actions">
              <LoadingButton busy={previewing} busyLabel="Previewing" className="link-button" disabled={!canPreview} onClick={previewImport} type="button">Preview</LoadingButton>
              <LoadingButton busy={importing} busyLabel="Importing" className="primary-action" disabled={!canImport} type="submit">{importLabel}</LoadingButton>
            </div>
          </fieldset>
          {(importing || previewing) && (
            <div className="inline-status import-status-line">
              <Spinner />
              {previewing ? "Reading the file" : "Saving transactions"}
            </div>
          )}
        </form>
      </section>

      {preview || importReport ? (
        <section className="panel import-result" aria-labelledby="import-result-title" ref={resultRef}>
          {preview
            ? <ImportPreview fileName={selectedFile?.name} hideAmounts={hideAmounts} preview={preview} />
            : <ImportReport hideAmounts={hideAmounts} report={importReport} />}
        </section>
      ) : null}

      <section className="panel import-recent" aria-labelledby="recent-imports-title">
        <div className="panel-header">
          <h2 id="recent-imports-title">Recent imports</h2>
          <div className="import-recent-tools">
            {recentImportsBusy ? <span className="inline-status"><Spinner /> Loading</span> : null}
            {showAllImports || recentImports.length >= RECENT_IMPORT_COUNT ? (
              <>
                <span className="muted">{showAllImports ? "All imports" : `Newest ${RECENT_IMPORT_COUNT}`}</span>
                <button className="text-button" onClick={() => setShowAllImports((value) => !value)} type="button">
                  {showAllImports ? "Show fewer" : "Show all"}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <RecentImports
          busyId={deletingImportId || reportImportId}
          deletingId={deletingImportId}
          imports={recentImports}
          onDelete={deleteImport}
          onShowReport={showImportReport}
          reportId={reportImportId}
        />
      </section>
    </div>
  );
}

// Rows the import would create: valid rows that aren't duplicates.
function newRowCount(summary = {}) {
  return Math.max(0, (summary.valid || 0) - (summary.duplicates || 0));
}

function MappingStatus({ account, mapping }) {
  if (!account) {
    return <p className="import-hint">Choose a bank account to see its default import mapping.</p>;
  }
  if (!mapping) {
    return (
      <div className="mapping-status mapping-status-warning">
        This bank account has no default import mapping. Set one in Definitions before importing.
      </div>
    );
  }
  const details = mappingDetailText(mapping);
  return (
    <p className="import-hint">
      Read with the mapping <strong>{mapping.name}</strong>{details ? ` (${details})` : ""}
    </p>
  );
}

function mappingDetailText(mapping) {
  if (!mapping.file_format) {
    return "";
  }
  if (isStatementFileFormat(mapping.file_format)) {
    return mappingFileFormatLabel(mapping.file_format);
  }
  const delimiter = mapping.delimiter === "\t" ? "tab" : `"${mapping.delimiter}"`;
  const dates = mapping.date_format ? `, dates ${readableDateFormat(mapping.date_format)}` : "";
  return `${mappingFileFormatLabel(mapping.file_format)}, ${delimiter} separated${dates}`;
}

// "%d.%m.%Y" reads as "DD.MM.YYYY".
function readableDateFormat(format) {
  return format.replace(/%d/g, "DD").replace(/%m/g, "MM").replace(/%Y/g, "YYYY").replace(/%y/g, "YY");
}

function ResultHeader({ detail, title }) {
  return (
    <div className="panel-header import-result-header">
      <h2 id="import-result-title">{title}</h2>
      {detail ? <span className="import-result-detail">{detail}</span> : null}
    </div>
  );
}

function ImportPreview({ fileName, hideAmounts, preview }) {
  const rows = preview.rows || [];
  const headers = preview.headers || [];
  const summary = preview.summary || {};
  return (
    <>
      <ResultHeader detail={fileName} title="Preview" />
      <ul aria-label="Preview summary" className="import-chips">
        <li className="import-chip">{pluralize(preview.loaded, "row")}</li>
        <li className="import-chip is-ok">{formatCount(newRowCount(summary))} new</li>
        <li className="import-chip">{pluralize(summary.duplicates, "duplicate")} skipped</li>
        <li className={`import-chip ${summary.errors ? "is-error" : ""}`.trim()}>{pluralize(summary.errors, "error")}</li>
        <li className={`import-chip ${summary.uncategorized ? "is-warning" : ""}`.trim()}>{formatCount(summary.uncategorized)} uncategorized</li>
      </ul>
      <StatementChecks statement={preview.statement} />
      {headers.length ? (
        <details className="import-columns">
          <summary>Columns in the file ({formatCount(headers.length)})</summary>
          <div className="import-header-list">
            {headers.map((header) => <span className="pill" key={header}>{header}</span>)}
          </div>
        </details>
      ) : null}
      {preview.loaded > rows.length ? (
        <p className="muted import-note">Showing the first {formatCount(rows.length)} of {formatCount(preview.loaded)} rows. The counts above cover the whole file.</p>
      ) : null}
      <div className="data-table-wrap">
        <table className="data-table import-preview-table">
          <thead>
            <tr>
              <th className="is-number">Line</th>
              <th>Date</th>
              <th>Description</th>
              <th className="is-number">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const display = previewRowDisplay(row, hideAmounts);
              const status = previewRowStatus(row, hideAmounts);
              return (
                <tr key={`${row.line || index}-${index}`}>
                  <td className="is-number muted">{row.line || NO_VALUE}</td>
                  <td>{display.date}</td>
                  <td className="data-table-text" title={display.description}>{display.description}</td>
                  <td className="is-number">{display.amount}</td>
                  <td className={`data-table-text import-row-status is-${status.tone}`} title={status.text}>{status.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function previewRowDisplay(row, hideAmounts) {
  if (row.status === "error") {
    return { amount: NO_VALUE, date: NO_VALUE, description: NO_VALUE };
  }
  const parsed = row.parsed || {};
  const amount = parsed.amount === undefined || parsed.amount === null || parsed.amount === ""
    ? NO_VALUE
    : `${formatAmountValue(parsed.amount, hideAmounts)}${parsed.currency ? ` ${parsed.currency}` : ""}`;
  return {
    amount,
    date: parsed.transaction_date || NO_VALUE,
    description: parsed.description || "No description",
  };
}

function previewRowStatus(row, hideAmounts) {
  if (row.status === "error") {
    return { text: `Error: ${row.error || "Parse error"}`, tone: "error" };
  }
  if (row.duplicate) {
    const duplicate = duplicateDisplay(row.duplicate_transaction, hideAmounts);
    return { text: duplicate ? `Duplicate of ${duplicate}` : "Duplicate", tone: "muted" };
  }
  const categorization = row.categorization || {};
  if (categorization.is_conflict) {
    return { text: "Conflict", tone: "warning" };
  }
  if (categorization.is_ignored) {
    return { text: "Ignored", tone: "muted" };
  }
  if (categorization.is_uncategorized) {
    return { text: "Ready · uncategorized", tone: "warning" };
  }
  const target = [categorization.category?.name, categorization.subcategory?.name].filter(Boolean).join(" › ");
  return { text: target ? `Ready · ${target}` : "Ready", tone: "ok" };
}

function ImportReport({ hideAmounts, report }) {
  const duplicates = report.skipped?.duplicates || [];
  const errors = report.skipped?.errors || [];
  // Reports list at most 100 failed rows; older reports have no total.
  const errorCount = report.skipped?.error_count ?? errors.length;
  const detail = report.source?.filename
    ? `${report.source.filename}${report.source.createdAt ? `, imported ${formatDateTime(report.source.createdAt)}` : ""}`
    : "";
  return (
    <>
      <ResultHeader detail={detail} title="Import report" />
      {report.error ? <div className="mapping-status mapping-status-warning">{report.error}</div> : null}
      <ul aria-label="Import summary" className="import-chips">
        <li className="import-chip">{pluralize(report.loaded, "row")} loaded</li>
        <li className="import-chip is-ok">{formatCount(report.created?.count)} created</li>
        <li className="import-chip">{pluralize(duplicates.length, "duplicate")} skipped</li>
        <li className={`import-chip ${errorCount ? "is-error" : ""}`.trim()}>{pluralize(errorCount, "error")}</li>
      </ul>
      <StatementChecks statement={report.statement} />
      {errors.length ? <ErrorList errorCount={errorCount} errors={errors} /> : null}
      {duplicates.length ? <DuplicateList duplicates={duplicates} hideAmounts={hideAmounts} /> : null}
    </>
  );
}

function StatementChecks({ statement }) {
  if (!statement) {
    return null;
  }
  const warnings = statement.warnings || [];
  if (!warnings.length) {
    return <div className="mapping-status">Statement checks passed.</div>;
  }
  return warnings.map((warning) => (
    <div className="mapping-status mapping-status-warning" key={warning}>{warning}</div>
  ));
}

function DuplicateList({ duplicates, hideAmounts }) {
  const shown = duplicates.slice(0, 12);
  return (
    <div className="import-report-section">
      <h3>Skipped duplicates</h3>
      <div className="data-table-wrap">
        <table className="data-table import-report-table">
          <thead>
            <tr>
              <th className="is-number">Line</th>
              <th>Description</th>
              <th>Matched transaction</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((duplicate, index) => {
              const existing = duplicateDisplay(duplicate.duplicate_transaction, hideAmounts);
              const description = duplicate.description || duplicate.reason || "";
              return (
                <tr key={`${duplicate.line || index}-${index}`}>
                  <td className="is-number muted">{duplicate.line || "?"}</td>
                  <td className="data-table-text" title={description}>{description}</td>
                  <td className="data-table-text" title={existing || duplicate.reason || ""}>{existing || duplicate.reason || "Duplicate transaction"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {duplicates.length > shown.length ? (
        <p className="muted import-note">+{pluralize(duplicates.length - shown.length, "more duplicate")}</p>
      ) : null}
    </div>
  );
}

function ErrorList({ errorCount, errors }) {
  const shown = errors.slice(0, 12);
  return (
    <div className="import-report-section">
      <h3>Rows with errors</h3>
      <div className="data-table-wrap">
        <table className="data-table import-report-table">
          <thead>
            <tr>
              <th className="is-number">Line</th>
              <th>Description</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((error, index) => (
              <tr key={`${error.line || index}-${index}`}>
                <td className="is-number muted">{error.line || "File"}</td>
                <td className="data-table-text" title={error.description || ""}>{error.description || "No description"}</td>
                <td className="data-table-text import-row-status is-error" title={error.error || ""}>{error.error || "Could not import this row"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errorCount > shown.length ? (
        <p className="muted import-note">+{pluralize(errorCount - shown.length, "more error")}</p>
      ) : null}
    </div>
  );
}

// "2026-10-24 - Fuel station - -1 182.15" for the transaction a row duplicates.
function duplicateDisplay(transaction, hideAmounts) {
  if (!transaction) {
    return "";
  }
  const amount = transaction.amount === undefined || transaction.amount === null
    ? ""
    : formatAmountValue(transaction.amount, hideAmounts);
  return [transaction.transaction_date, transaction.description, amount].filter(Boolean).join(" - ");
}

function RecentImports({ busyId, deletingId, imports, onDelete, onShowReport, reportId }) {
  if (!imports.length) {
    return <p className="muted">No imports yet.</p>;
  }
  return (
    <div className="data-table-wrap">
      <table className="data-table recent-imports-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Account</th>
            <th>Imported</th>
            <th className="is-number">New</th>
            <th className="is-number">Skipped</th>
            <th className="is-number">Errors</th>
            <th><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {imports.map((item) => {
            const fileName = item.source_filename || "Import";
            return (
              <tr key={item.id}>
                <td className="data-table-text" title={fileName}>{fileName}</td>
                <td className="data-table-text">{item.bank_account?.name || "No account"}</td>
                <td className="data-table-time">{formatDateTime(item.created_at)}</td>
                <td className="is-number">{formatCount(item.created_count)}</td>
                <td className="is-number">{formatCount(item.skipped_count)}</td>
                <td className={`is-number ${item.error_count ? "import-row-status is-error" : ""}`.trim()}>{formatCount(item.error_count)}</td>
                <td className="data-table-actions">
                  <LoadingButton
                    busy={reportId === item.id}
                    busyLabel="Loading"
                    className="text-button"
                    disabled={Boolean(busyId)}
                    onClick={() => onShowReport(item)}
                    type="button"
                  >
                    Report
                  </LoadingButton>
                  <LoadingButton
                    aria-label={`Delete import of ${fileName}`}
                    busy={deletingId === item.id}
                    busyLabel=""
                    className="icon-action icon-action-danger"
                    disabled={Boolean(busyId)}
                    onClick={() => onDelete(item)}
                    title={`Delete import of ${fileName}`}
                    type="button"
                  >
                    <TrashIcon size={16} />
                  </LoadingButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
