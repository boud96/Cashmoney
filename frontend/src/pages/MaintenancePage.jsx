import { useState } from "react";

import { apiDelete, apiPost } from "../api.js";
import { LoadingButton, Metric } from "../components.jsx";
import { formatCount } from "../shared.js";

export default function MaintenancePage({ notify, reloadAll, reloadDashboard, reloadMaintenance, summary }) {
  const [deleting, setDeleting] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [safeBusy, setSafeBusy] = useState("");
  const counts = summary || {};
  const definitionObjectCount = [
    counts.bank_accounts,
    counts.csv_mappings,
    counts.categories,
    counts.subcategories,
    counts.tags,
    counts.keywords,
  ].reduce((total, value) => total + Number(value || 0), 0);
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
  const snapshot = [
    ["Transactions", counts.transactions],
    ["Imports", counts.imports],
    ["Definitions", definitionObjectCount],
    ["Exchange Rates", counts.exchange_rates],
    ["Saved Filters", counts.saved_filters],
    ["Sample Data", sampleObjectCount],
  ];
  const transactionObjectCount = Number(counts.transactions || 0) + Number(counts.imports || 0);
  const sampleDataAction = {
    count: sampleObjectCount,
    description: "Remove only objects created by the first-launch demo dataset.",
    endpoint: "/maintenance/sample-data/",
    phrase: "DELETE SAMPLE DATA",
    title: "Delete sample data",
  };
  const dangerActions = [
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
          <span className="muted">Current local database totals.</span>
        </div>
        <div className="maintenance-counts">
          {snapshot.map(([label, value]) => (
            <Metric key={label} label={label} value={formatCount(value)} />
          ))}
        </div>
      </section>

      <MaintenanceSection defaultExpanded storageId="backups" subtitle="Export or restore the complete local SQLite database." title="Backups">
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
          <article className="maintenance-tool-card restore-card">
            <div>
              <h3>Restore database backup</h3>
              <p>Replace the current local database from a Cashmoney SQLite backup. The app saves a pre-restore backup first.</p>
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
      </MaintenanceSection>

      <MaintenanceSection storageId="sample-data" subtitle="Recreate or remove the demo records used for first-run exploration." title="Sample Data">
        <div className="maintenance-tool-grid">
          <article className="maintenance-tool-card">
            <div>
              <h3>Recreate sample data</h3>
              <p>Reset only the sample dataset and create the demo records again.</p>
            </div>
            <LoadingButton
              busy={safeBusy === "samples"}
              busyLabel="Recreating"
              className="link-button"
              disabled={Boolean(safeBusy) || Boolean(deleting)}
              onClick={recreateSampleData}
              type="button"
            >
              Recreate Samples
            </LoadingButton>
          </article>
          <article className="maintenance-tool-card danger-tool-card">
            <div>
              <h3>{sampleDataAction.title}</h3>
              <p>{sampleDataAction.description}</p>
              <div className="danger-count">{formatCount(sampleDataAction.count)} affected</div>
            </div>
            <LoadingButton
              busy={deleting === sampleDataAction.phrase}
              busyLabel="Deleting"
              className="danger-button"
              disabled={Boolean(deleting) || Boolean(safeBusy)}
              onClick={() => deleteMaintenanceData(sampleDataAction)}
              type="button"
            >
              Delete Samples
            </LoadingButton>
          </article>
        </div>
      </MaintenanceSection>

      <MaintenanceSection danger storageId="danger-zone" subtitle="Permanent cleanup and direct database access." title="Danger Zone">
        <div className="maintenance-tool-grid">
          <article className="maintenance-tool-card danger-tool-card">
            <div>
              <h3>Django admin</h3>
              <p>Open the raw Django admin interface for direct database maintenance.</p>
            </div>
            <a className="danger-button danger-link-button" href="/admin/" rel="noreferrer" target="_blank">
              Admin
            </a>
          </article>
          {dangerActions.map((action) => (
            <article className="maintenance-tool-card danger-tool-card" key={action.phrase}>
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
      </MaintenanceSection>
    </>
  );
}

function maintenancePanelStorageKey(storageId) {
  return `cashmoney.maintenance.panel.${storageId}`;
}

function readStoredMaintenancePanelState(storageId, defaultExpanded) {
  if (typeof window === "undefined") {
    return defaultExpanded;
  }
  try {
    const stored = window.localStorage.getItem(maintenancePanelStorageKey(storageId));
    return stored === null ? defaultExpanded : stored === "1";
  } catch {
    return defaultExpanded;
  }
}

function MaintenanceSection({ children, danger = false, defaultExpanded = false, storageId, subtitle, title }) {
  const [expanded, setExpanded] = useState(() => readStoredMaintenancePanelState(storageId, defaultExpanded));

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(maintenancePanelStorageKey(storageId), next ? "1" : "0");
      } catch {
        // Storage is optional; the section can still toggle for this session.
      }
      return next;
    });
  }

  return (
    <section className={`panel definition-panel maintenance-section ${danger ? "danger-maintenance-section" : ""} ${expanded ? "is-expanded" : "is-collapsed"}`.trim()}>
      <div className="definition-panel-header">
        <button
          aria-expanded={expanded}
          className="definition-panel-toggle"
          onClick={toggleExpanded}
          type="button"
        >
          <span className="definition-panel-heading">
            <span className="definition-panel-title-line">
              <span className="definition-panel-title">{title}</span>
            </span>
            {subtitle ? <span className="definition-panel-subtitle">{subtitle}</span> : null}
          </span>
          <span aria-hidden="true" className="definition-panel-state">{expanded ? "Hide" : "Show"}</span>
        </button>
      </div>
      <div className="definition-panel-body">
        {children}
      </div>
    </section>
  );
}
