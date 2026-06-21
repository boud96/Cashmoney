import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "../api.js";
import { LoadingButton, Metric, Spinner } from "../components.jsx";
import { formatAmountValue } from "../shared.js";

export default function ImportPage({ hideAmounts = false, importReport, notify, refs, reloadAll, setImportReport }) {
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [recentImports, setRecentImports] = useState([]);
  const [recentImportsBusy, setRecentImportsBusy] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const selectedAccount = useMemo(
    () => refs.accounts.find((account) => account.id === selectedAccountId) || null,
    [refs.accounts, selectedAccountId],
  );
  const defaultMapping = selectedAccount?.default_csv_mapping || null;
  const canPreview = Boolean(selectedFile && selectedAccountId && defaultMapping && !importing && !previewing);
  const canImport = Boolean(preview && canPreview);

  const loadRecentImports = useCallback(async () => {
    setRecentImportsBusy(true);
    try {
      setRecentImports(await apiGet("/imports/", { limit: 8 }));
    } catch (error) {
      notify(error.message);
    } finally {
      setRecentImportsBusy(false);
    }
  }, [notify]);

  useEffect(() => {
    loadRecentImports();
  }, [loadRecentImports]);

  function setFile(file) {
    setSelectedFile(file || null);
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

  async function previewImport() {
    if (!canPreview) {
      return;
    }
    setPreviewing(true);
    try {
      const formData = buildFormData();
      formData.append("sample_size", "100");
      const response = await fetch("/api/imports/preview/", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Preview failed");
      }
      setPreview(payload);
      notify("CSV preview ready");
    } catch (error) {
      notify(error.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function submitImport(event) {
    event.preventDefault();
    if (!canImport) {
      notify("Preview the CSV before importing");
      return;
    }
    setImporting(true);
    try {
      const response = await fetch("/api/imports/", { method: "POST", body: buildFormData() });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Import failed");
      }
      setImportReport(payload.report);
      setPreview(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      notify("CSV imported");
      await Promise.all([reloadAll(), loadRecentImports()]);
    } catch (error) {
      notify(error.message);
    } finally {
      setImporting(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    setFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div className="import-workspace">
      <section className="filter-panel import-source-panel" aria-labelledby="import-source-title">
        <h2 className="dashboard-section-title" id="import-source-title">Import CSV</h2>
        <form className="import-form" onSubmit={submitImport}>
          <fieldset disabled={importing || previewing}>
            <label
              className={`csv-drop-zone ${dragActive ? "is-active" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                accept=".csv,text/csv"
                name="csv_file"
                onChange={(event) => setFile(event.target.files?.[0])}
                ref={fileInputRef}
                type="file"
              />
              <span className="csv-drop-title">{selectedFile ? selectedFile.name : "Drop CSV file here"}</span>
              <span className="csv-drop-meta">{selectedFile ? `${formatBytes(selectedFile.size)} selected` : "or click to browse"}</span>
            </label>
            <label className="form-field">
              <span>Bank account</span>
              <select onChange={(event) => updateAccount(event.target.value)} required value={selectedAccountId}>
                <option value="">Choose bank account</option>
                {refs.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <MappingStatus account={selectedAccount} mapping={defaultMapping} />
            <div className="import-action-row">
              <LoadingButton busy={previewing} busyLabel="Previewing" className="link-button" disabled={!canPreview} onClick={previewImport} type="button">Preview Import</LoadingButton>
              <LoadingButton busy={importing} busyLabel="Importing" className="primary-action" disabled={!canImport} type="submit">Import Valid Rows</LoadingButton>
            </div>
            {(importing || previewing) && (
              <div className="inline-status">
                <Spinner />
                {previewing ? "Reading CSV preview" : "Saving transactions"}
              </div>
            )}
          </fieldset>
        </form>
      </section>

      <section className="filter-panel import-preview-panel" aria-labelledby="import-preview-title">
        <h2 className="dashboard-section-title" id="import-preview-title">Preview</h2>
        {preview ? <ImportPreview hideAmounts={hideAmounts} preview={preview} /> : <ImportEmptyState />}
      </section>

      <section className="filter-panel import-report-panel" aria-labelledby="import-report-title">
        <h2 className="dashboard-section-title" id="import-report-title">Import Report</h2>
        {importReport ? <ImportReport report={importReport} /> : <div className="muted">Run an import to see the latest result.</div>}
      </section>

      <section className="filter-panel import-recent-panel" aria-labelledby="recent-imports-title">
        <div className="panel-header compact-panel-header">
          <h2 className="dashboard-section-title" id="recent-imports-title">Recent Imports</h2>
          {recentImportsBusy ? <span className="inline-status"><Spinner /> Loading</span> : null}
        </div>
        <RecentImports imports={recentImports} />
      </section>
    </div>
  );
}

function MappingStatus({ account, mapping }) {
  if (!account) {
    return <div className="mapping-status">Choose a bank account to see the default CSV mapping.</div>;
  }
  if (!mapping) {
    return (
      <div className="mapping-status mapping-status-warning">
        This bank account has no default CSV mapping. Set one in Definitions before importing.
      </div>
    );
  }
  return (
    <div className="mapping-status">
      <span>Using mapping</span>
      <strong>{mapping.name}</strong>
    </div>
  );
}

function ImportPreview({ hideAmounts, preview }) {
  const rows = preview.rows || [];
  const headers = preview.headers || [];
  const summary = preview.summary || {};
  return (
    <div className="import-preview-content">
      <div className="import-preview-summary">
        <Metric label="Rows loaded" value={preview.loaded || 0} />
        <Metric label="Valid sample" value={summary.valid || 0} />
        <Metric label="Duplicates" value={summary.duplicates || 0} />
        <Metric label="Errors" tone={summary.errors ? "negative" : ""} value={summary.errors || 0} />
      </div>
      <div className="import-header-list">
        {headers.slice(0, 18).map((header) => <span className="pill" key={header}>{header}</span>)}
        {headers.length > 18 ? <span className="pill tag-more-pill">+{headers.length - 18}</span> : null}
      </div>
      <div className="import-sample-list">
        {rows.map((row, index) => {
          const label = previewRowLabel(row);
          const display = previewRowDisplay(row, hideAmounts);
          return (
            <div className="import-sample-row" key={`${row.line || index}-${index}`}>
              <div className="import-sample-main">
                <div className="import-sample-meta">
                  <span>{display.date}</span>
                  {display.amount ? <span>{display.amount}</span> : null}
                </div>
                <strong title={display.description}>{display.description}</strong>
              </div>
              <span className={`import-sample-status ${row.status === "error" ? "is-error" : ""}`} title={label}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function previewRowDisplay(row, hideAmounts) {
  const parsed = row.parsed || {};
  const amount = parsed.amount === undefined || parsed.amount === null || parsed.amount === ""
    ? ""
    : `${formatAmountValue(parsed.amount, hideAmounts)}${parsed.currency ? ` ${parsed.currency}` : ""}`;
  return {
    date: parsed.transaction_date || "No date",
    description: parsed.description || row.error || "No description",
    amount,
  };
}

function previewRowLabel(row) {
  if (row.status === "error") {
    return row.error || "Parse error";
  }
  if (row.duplicate) {
    return "Duplicate";
  }
  if (row.categorization?.is_conflict) {
    return "Conflict";
  }
  if (row.categorization?.is_ignored) {
    return "Ignored";
  }
  if (row.categorization?.is_uncategorized) {
    return "Uncategorized";
  }
  return "Ready";
}

function ImportReport({ report }) {
  return (
    <div className="metrics-grid report-grid">
      <Metric label="Loaded" value={report.loaded} />
      <Metric label="Created" tone="positive" value={report.created?.count || 0} />
      <Metric label="Duplicates" value={report.skipped?.duplicates?.length || 0} />
      <Metric label="Errors" tone="negative" value={report.skipped?.errors?.length || 0} />
    </div>
  );
}

function ImportEmptyState() {
  return (
    <div className="import-empty-state">
      Select a CSV file and bank account, then preview the import before saving transactions.
    </div>
  );
}

function RecentImports({ imports }) {
  if (!imports.length) {
    return <div className="muted">No imports yet.</div>;
  }
  return (
    <div className="recent-import-list">
      {imports.map((item) => (
        <div className="recent-import-item" key={item.id}>
          <div>
            <strong>{item.source_filename || "CSV import"}</strong>
            <span>{item.bank_account?.name || "No account"} | {formatDateTime(item.created_at)}</span>
          </div>
          <div className="recent-import-counts">
            <span>{item.created_count} created</span>
            <span>{item.skipped_count} skipped</span>
            <span>{item.error_count} errors</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatBytes(size) {
  if (!Number.isFinite(size)) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString();
}
