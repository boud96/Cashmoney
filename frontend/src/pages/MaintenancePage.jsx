import { useEffect, useState } from "react";

import { apiDelete, apiGet, apiPost } from "../api.js";
import { LoadingButton, Metric } from "../components.jsx";
import { formatBytes, formatCount, formatDateTime } from "../shared.js";

export default function MaintenancePage({ confirmAction, notify, reloadAll, reloadDashboard, reloadMaintenance, summary }) {
  const [deleting, setDeleting] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [safeBusy, setSafeBusy] = useState("");
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupAction, setBackupAction] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminDraft, setAdminDraft] = useState({
    password: "",
    passwordConfirmation: "",
    username: "admin",
  });
  const counts = summary || {};
  const hasAdminUser = Boolean(counts.has_admin_user);
  const adminUserCount = Number(counts.admin_user_count || 0);
  const adminMode = hasAdminUser ? "reset" : "create";
  const adminConfirmation = hasAdminUser ? "RESET ADMIN PASSWORD" : "CREATE ADMIN USER";
  const adminActionLabel = hasAdminUser ? "Reset Admin Password" : "Create Admin User";
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
    counts.internal_transfer_matches,
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
    ["Transfer Matches", counts.internal_transfer_matches],
    ["Imports", counts.imports],
    ["Definitions", definitionObjectCount],
    ["Exchange Rates", counts.exchange_rates],
    ["Saved Filters", counts.saved_filters],
    ["Sample Data", sampleObjectCount],
  ];
  const transactionObjectCount = Number(counts.transactions || 0) + Number(counts.internal_transfer_matches || 0) + Number(counts.imports || 0);
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
      description: (
        "Remove transactions, imports, keywords, accounts, mappings, tags, "
        + "subcategories, and categories. Admin users stay intact."
      ),
      endpoint: "/maintenance/finance-data/",
      phrase: "DELETE ALL FINANCE DATA",
      title: "Delete all finance data",
    },
  ];
  const backupBusy = Boolean(backupAction) || Boolean(safeBusy) || Boolean(deleting);

  useEffect(() => {
    loadBackups();
  }, []);

  async function loadBackups() {
    setBackupsLoading(true);
    try {
      const payload = await apiGet("/maintenance/backups/");
      setBackups(payload.backups || []);
    } catch (error) {
      notify(error.message);
    } finally {
      setBackupsLoading(false);
    }
  }

  async function deleteMaintenanceData(action) {
    const confirmed = await confirmAction({
      confirmLabel: "Delete",
      danger: true,
      message: `${action.title}?\n\n${action.description}`,
      title: action.title,
    });
    if (!confirmed) {
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
      await downloadResponseAttachment(response, "cashmoney-backup.sqlite3", "Backup failed");
      notify("Database backup downloaded");
    } catch (error) {
      notify(error.message);
    } finally {
      setSafeBusy("");
    }
  }

  async function exportSavedBackup(backup) {
    setBackupAction(`export:${backup.filename}`);
    try {
      const response = await fetch(
        `/api/maintenance/backups/${encodeURIComponent(backup.filename)}/export/`
      );
      await downloadResponseAttachment(response, backup.filename, "Backup export failed");
      notify("Backup downloaded");
    } catch (error) {
      notify(error.message);
    } finally {
      setBackupAction("");
    }
  }

  async function restoreSavedBackup(backup) {
    const confirmed = await confirmAction({
      confirmLabel: "Restore",
      danger: true,
      message: `Restore ${backup.filename}?\n\nThis replaces the current local database. A pre-restore backup will be saved automatically.`,
      title: "Restore Backup",
    });
    if (!confirmed) {
      return;
    }
    setBackupAction(`restore:${backup.filename}`);
    try {
      const payload = await apiPost(
        `/maintenance/backups/${encodeURIComponent(backup.filename)}/restore/`,
        { confirmation: "RESTORE DATABASE" }
      );
      setBackups(payload.backups || []);
      notify("Database restored");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      notify(error.message);
    } finally {
      setBackupAction("");
    }
  }

  async function deleteSavedBackup(backup) {
    const confirmed = await confirmAction({
      confirmLabel: "Delete",
      danger: true,
      message: `Delete ${backup.filename}?\n\nThis removes the saved backup file. The current database is not changed.`,
      title: "Delete Backup",
    });
    if (!confirmed) {
      return;
    }
    setBackupAction(`delete:${backup.filename}`);
    try {
      const payload = await apiDelete(
        `/maintenance/backups/${encodeURIComponent(backup.filename)}/`,
        { confirmation: "DELETE BACKUP" }
      );
      setBackups(payload.backups || []);
      notify("Backup deleted");
    } catch (error) {
      notify(error.message);
    } finally {
      setBackupAction("");
    }
  }

  async function restoreDatabase(event) {
    event.preventDefault();
    if (!restoreFile) {
      return;
    }
    const confirmed = await confirmAction({
      confirmLabel: "Restore",
      danger: true,
      message: "Restore database backup?\n\nThis replaces the current local database. A pre-restore backup will be saved automatically.",
      title: "Restore Database",
    });
    if (!confirmed) {
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
      setBackups(payload.backups || []);
      notify("Database restored");
      setRestoreFile(null);
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      notify(error.message);
    } finally {
      setSafeBusy("");
    }
  }

  function updateAdminDraft(field, value) {
    setAdminDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveAdminUser(event) {
    event.preventDefault();
    if (adminDraft.password !== adminDraft.passwordConfirmation) {
      notify("Password confirmation does not match");
      return;
    }
    const confirmed = await confirmAction({
      confirmLabel: hasAdminUser ? "Reset" : "Create",
      danger: true,
      message: `${adminActionLabel}?\n\nThis creates or updates a local Django admin user for direct database maintenance.`,
      title: adminActionLabel,
    });
    if (!confirmed) {
      return;
    }
    setAdminBusy(true);
    try {
      const payload = await apiPost("/maintenance/admin-user/", {
        confirmation: adminConfirmation,
        mode: adminMode,
        password: adminDraft.password,
        password_confirmation: adminDraft.passwordConfirmation,
        username: adminDraft.username,
      });
      notify(payload.admin?.created ? "Admin user created" : "Admin password reset");
      setAdminDraft((current) => ({
        ...current,
        password: "",
        passwordConfirmation: "",
      }));
      await reloadMaintenance();
    } catch (error) {
      notify(error.message);
    } finally {
      setAdminBusy(false);
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

      <MaintenanceSection
        defaultExpanded
        storageId="backups"
        subtitle="Export or restore the complete local SQLite database."
        title="Backups"
      >
        <div className="maintenance-backup-list">
          <article className="maintenance-backup-row is-current">
            <div>
              <h3>Current database</h3>
              <p>The live local database state.</p>
              <div className="backup-meta">Current</div>
            </div>
            <div className="backup-actions">
              <LoadingButton
                busy={safeBusy === "backup"}
                busyLabel="Exporting"
                className="primary-action"
                disabled={backupBusy}
                onClick={exportBackup}
                type="button"
              >
                Export
              </LoadingButton>
            </div>
          </article>
          {backupsLoading ? (
            <div className="backup-empty-state">Loading backups...</div>
          ) : backups.length ? (
            backups.map((backup) => (
              <article className="maintenance-backup-row" key={backup.filename}>
                <div>
                  <h3>{backup.filename}</h3>
                  <p>{backup.label || "Backup"}</p>
                  <div className="backup-meta">
                    {formatDateTime(backup.modified_at, "Unknown date")} | {formatBytes(backup.size_bytes, "0 B")}
                  </div>
                </div>
                <div className="backup-actions">
                  <LoadingButton
                    busy={backupAction === `restore:${backup.filename}`}
                    busyLabel="Restoring"
                    className="danger-button"
                    disabled={backupBusy}
                    onClick={() => restoreSavedBackup(backup)}
                    type="button"
                  >
                    Restore
                  </LoadingButton>
                  <LoadingButton
                    busy={backupAction === `export:${backup.filename}`}
                    busyLabel="Exporting"
                    className="link-button"
                    disabled={backupBusy}
                    onClick={() => exportSavedBackup(backup)}
                    type="button"
                  >
                    Export
                  </LoadingButton>
                  <LoadingButton
                    busy={backupAction === `delete:${backup.filename}`}
                    busyLabel="Deleting"
                    className="danger-button"
                    disabled={backupBusy}
                    onClick={() => deleteSavedBackup(backup)}
                    type="button"
                  >
                    Delete
                  </LoadingButton>
                </div>
              </article>
            ))
          ) : (
            <div className="backup-empty-state">
              No saved backups yet. Pre-restore backups will appear here after a database restore.
            </div>
          )}
        </div>
        <div className="maintenance-tool-grid">
          <article className="maintenance-tool-card restore-card">
            <div>
              <h3>Restore database backup</h3>
              <p>
                Replace the current local database from a Cashmoney SQLite backup.
                The app saves a pre-restore backup first.
              </p>
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
                disabled={backupBusy || !restoreFile}
                type="submit"
              >
                Restore Database
              </LoadingButton>
            </form>
          </article>
        </div>
      </MaintenanceSection>

      <MaintenanceSection
        storageId="sample-data"
        subtitle="Recreate or remove the demo records used for first-run exploration."
        title="Sample Data"
      >
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

      <MaintenanceSection
        danger
        storageId="danger-zone"
        subtitle="Permanent cleanup and direct database access."
        title="Danger Zone"
      >
        <div className="maintenance-tool-grid">
          <article className="maintenance-tool-card danger-tool-card admin-tool-card">
            <div className="admin-tool-header">
              <div>
                <h3>Django admin</h3>
              <p>
                {hasAdminUser
                  ? `Admin access is configured for ${formatCount(adminUserCount)} user${adminUserCount === 1 ? "" : "s"}.`
                  : "Create a local admin user to open Django admin."}
              </p>
              </div>
              {hasAdminUser && (
                <a className="danger-button danger-link-button" href="/admin/" rel="noreferrer" target="_blank">
                  Open Admin
                </a>
              )}
            </div>
            <form className="admin-user-form" onSubmit={saveAdminUser}>
              <label>
                <span>Username</span>
                <input
                  autoComplete="username"
                  onChange={(event) => updateAdminDraft("username", event.target.value)}
                  required
                  value={adminDraft.username}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete="new-password"
                  onChange={(event) => updateAdminDraft("password", event.target.value)}
                  required
                  type="password"
                  value={adminDraft.password}
                />
              </label>
              <label>
                <span>Confirm password</span>
                <input
                  autoComplete="new-password"
                  onChange={(event) => updateAdminDraft("passwordConfirmation", event.target.value)}
                  required
                  type="password"
                  value={adminDraft.passwordConfirmation}
                />
              </label>
              <LoadingButton
                busy={adminBusy}
                busyLabel="Saving"
                className="danger-button admin-user-submit"
                disabled={Boolean(deleting)}
                type="submit"
              >
                {adminActionLabel}
              </LoadingButton>
            </form>
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

async function downloadResponseAttachment(response, fallbackFilename, fallbackError) {
  if (!response.ok) {
    let message = fallbackError;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Keep the fallback message when the server did not return JSON.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackFilename;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
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
  const panelClassName = [
    "panel",
    "definition-panel",
    "maintenance-section",
    danger ? "danger-maintenance-section" : "",
    expanded ? "is-expanded" : "is-collapsed",
  ].filter(Boolean).join(" ");

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
    <section className={panelClassName}>
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
