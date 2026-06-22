import { useState } from "react";

import { apiDelete, apiPost } from "../api.js";
import { LoadingButton, Metric } from "../components.jsx";
import { formatCount } from "../shared.js";

export default function MaintenancePage({ notify, reloadAll, reloadDashboard, reloadMaintenance, summary }) {
  const [deleting, setDeleting] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [safeBusy, setSafeBusy] = useState("");
  const [refreshingCounts, setRefreshingCounts] = useState(false);
  const counts = summary || {};
  const snapshot = [
    ["Transactions", counts.transactions],
    ["Imports", counts.imports],
    ["Exchange Rates", counts.exchange_rates],
    ["Sample Transactions", counts.sample_transactions],
    ["Accounts", counts.bank_accounts],
    ["CSV Mappings", counts.csv_mappings],
    ["Categories", counts.categories],
    ["Subcategories", counts.subcategories],
    ["Tags", counts.tags],
    ["Keywords", counts.keywords],
    ["Saved filters", counts.saved_filters],
  ];
  const financeObjectCount = [
    counts.transactions,
    counts.imports,
    counts.exchange_rates,
    counts.bank_accounts,
    counts.csv_mappings,
    counts.categories,
    counts.subcategories,
    counts.tags,
    counts.keywords,
    counts.saved_filters,
  ].reduce((total, value) => total + Number(value || 0), 0);
  const sampleObjectCount = [
    counts.sample_transactions,
    counts.sample_imports,
    counts.sample_bank_accounts,
    counts.sample_csv_mappings,
    counts.sample_categories,
    counts.sample_subcategories,
    counts.sample_tags,
    counts.sample_keywords,
  ].reduce((total, value) => total + Number(value || 0), 0);
  const transactionObjectCount = Number(counts.transactions || 0) + Number(counts.imports || 0);
  const actions = [
    {
      count: sampleObjectCount,
      description: "Remove only objects created by the first-launch demo dataset.",
      endpoint: "/maintenance/sample-data/",
      phrase: "DELETE SAMPLE DATA",
      title: "Delete sample data",
    },
    {
      count: transactionObjectCount,
      description: "Remove every transaction and all CSV import history. Definitions stay intact.",
      endpoint: "/maintenance/transactions/",
      phrase: "DELETE ALL TRANSACTIONS",
      title: "Delete all transactions",
    },
    {
      count: financeObjectCount,
      description: "Remove transactions, imports, keywords, accounts, mappings, tags, subcategories, and categories. Admin users stay intact.",
      endpoint: "/maintenance/finance-data/",
      phrase: "DELETE ALL FINANCE DATA",
      title: "Delete all finance data",
    },
  ];

  async function deleteMaintenanceData(action) {
    if (!window.confirm(`${action.title}?\n\n${action.description}`)) {
      return;
    }
    setDeleting(action.phrase);
    try {
      await apiDelete(action.endpoint, { confirmation: action.phrase });
      notify(`${action.title} completed`);
      await Promise.all([reloadMaintenance(), reloadAll(), reloadDashboard()]);
    } catch (error) {
      notify(error.message);
    } finally {
      setDeleting("");
    }
  }

  async function refreshCounts() {
    setRefreshingCounts(true);
    try {
      await reloadMaintenance();
    } finally {
      setRefreshingCounts(false);
    }
  }

  async function recreateSampleData() {
    setSafeBusy("samples");
    try {
      await apiPost("/maintenance/sample-data/recreate/", {});
      notify("Sample data recreated");
      await Promise.all([reloadMaintenance(), reloadAll(), reloadDashboard()]);
    } catch (error) {
      notify(error.message);
    } finally {
      setSafeBusy("");
    }
  }

  async function exportBackup() {
    setSafeBusy("backup");
    try {
      const response = await fetch("/api/maintenance/database-backup/");
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Backup failed");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "cashmoney-backup.sqlite3";
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      notify("Database backup downloaded");
    } catch (error) {
      notify(error.message);
    } finally {
      setSafeBusy("");
    }
  }

  async function restoreDatabase(event) {
    event.preventDefault();
    if (!restoreFile) {
      return;
    }
    if (!window.confirm("Restore database backup?\n\nThis replaces the current local database. A pre-restore backup will be saved automatically.")) {
      return;
    }
    setSafeBusy("restore");
    try {
      const formData = new FormData();
      formData.append("backup_file", restoreFile);
      formData.append("confirmation", "RESTORE DATABASE");
      const response = await fetch("/api/maintenance/database-restore/", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Restore failed");
      }
      notify("Database restored");
      setRestoreFile(null);
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      notify(error.message);
    } finally {
      setSafeBusy("");
    }
  }

  return (
    <>
      <section className="panel maintenance-snapshot">
        <div className="panel-header">
          <h2>Database Snapshot</h2>
          <LoadingButton busy={refreshingCounts} busyLabel="Refreshing" className="link-button" onClick={refreshCounts} type="button">Refresh Counts</LoadingButton>
        </div>
        <div className="maintenance-counts">
          {snapshot.map(([label, value]) => (
            <Metric key={label} label={label} value={formatCount(value)} />
          ))}
        </div>
      </section>

      <section className="panel maintenance-tools">
        <div className="panel-header">
          <h2>Safe Tools</h2>
          <span className="muted">Useful before or after cleanup.</span>
        </div>
        <div className="maintenance-tool-grid">
          <article className="maintenance-tool-card">
            <div>
              <h3>Export database backup</h3>
              <p>Download a SQLite backup of the current local database.</p>
            </div>
            <LoadingButton
              busy={safeBusy === "backup"}
              busyLabel="Exporting"
              className="primary-action"
              disabled={Boolean(safeBusy)}
              onClick={exportBackup}
              type="button"
            >
              Export Backup
            </LoadingButton>
          </article>
          <article className="maintenance-tool-card">
            <div>
              <h3>Recreate sample data</h3>
              <p>Reset only the sample dataset and create the demo records again.</p>
            </div>
            <LoadingButton
              busy={safeBusy === "samples"}
              busyLabel="Recreating"
              className="link-button"
              disabled={Boolean(safeBusy)}
              onClick={recreateSampleData}
              type="button"
            >
              Recreate Samples
            </LoadingButton>
          </article>
          <article className="maintenance-tool-card restore-card">
            <div>
              <h3>Restore database backup</h3>
              <p>Replace the current local database from a Cashmoney SQLite backup. A pre-restore backup is saved automatically.</p>
            </div>
            <form className="restore-form" onSubmit={restoreDatabase}>
              <label>
                <span>Backup file</span>
                <input
                  accept=".sqlite3,.db,application/x-sqlite3"
                  onChange={(event) => setRestoreFile(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              <LoadingButton
                busy={safeBusy === "restore"}
                busyLabel="Restoring"
                className="danger-button"
                disabled={Boolean(safeBusy) || !restoreFile}
                type="submit"
              >
                Restore Database
              </LoadingButton>
            </form>
          </article>
        </div>
      </section>

      <section className="danger-zone">
        <div className="danger-zone-header">
          <h2>Danger Zone</h2>
          <p>These actions permanently remove local finance data from this database.</p>
        </div>
        <div className="danger-action-grid">
          <article className="danger-card">
            <div>
              <h3>Django admin</h3>
              <p>Open the raw Django admin interface for direct database maintenance.</p>
            </div>
            <a className="danger-button danger-link-button" href="/admin/" rel="noreferrer" target="_blank">
              Admin
            </a>
          </article>
          {actions.map((action) => (
            <article className="danger-card" key={action.phrase}>
              <div>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
                <div className="danger-count">{formatCount(action.count)} affected</div>
              </div>
              <LoadingButton
                busy={deleting === action.phrase}
                busyLabel="Deleting"
                className="danger-button"
                disabled={Boolean(deleting)}
                onClick={() => deleteMaintenanceData(action)}
                type="button"
              >
                {action.title}
              </LoadingButton>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
