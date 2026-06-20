import { useState } from "react";

import { LoadingButton, Metric, Select, Spinner } from "../components.jsx";

export default function ImportPage({ importReport, notify, refs, reloadAll, setImportReport }) {
  const [importing, setImporting] = useState(false);

  async function submitImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setImporting(true);
    try {
      const response = await fetch("/api/imports/", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Import failed");
      }
      setImportReport(payload.report);
      form.reset();
      notify("CSV imported");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="panel import-layout">
      <form className="stack-form" onSubmit={submitImport}>
        <fieldset disabled={importing}>
          <label><span>CSV file</span><input accept=".csv,text/csv" name="csv_file" required type="file" /></label>
          <label><span>Bank account</span><Select name="bank_account_id" options={refs.accounts.map((item) => [item.id, item.name])} required /></label>
          <LoadingButton busy={importing} busyLabel="Importing" className="primary-action" type="submit">Import CSV</LoadingButton>
          {importing && <div className="inline-status"><Spinner /> Reading and importing CSV</div>}
        </fieldset>
      </form>
      <div className="import-report">
        {importReport && (
          <>
            <h2>Import Report</h2>
            <div className="metrics-grid report-grid">
              <Metric label="Loaded" value={importReport.loaded} />
              <Metric label="Created" tone="positive" value={importReport.created?.count || 0} />
              <Metric label="Duplicates" value={importReport.skipped?.duplicates?.length || 0} />
              <Metric label="Errors" tone="negative" value={importReport.skipped?.errors?.length || 0} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
