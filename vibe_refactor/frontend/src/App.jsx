import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

import { apiDelete, apiGet, apiPatch, apiPost } from "./api.js";

ModuleRegistry.registerModules([AllCommunityModule]);

const Plot = createPlotlyComponent(Plotly);
const UNASSIGNED = "__unassigned__";
const pages = {
  dashboard: ["Dashboard", "Monthly flow, category mix, and transaction review."],
  import: ["Import", "Load bank statement CSV files into the local transaction database."],
  settings: ["Definitions", "Manage accounts, mappings, categories, tags, and keyword rules."],
  maintenance: ["Maintenance", "Database snapshot and destructive cleanup tools."],
};
const wniOptions = [
  ["want", "Want"],
  ["need", "Need"],
  ["investment", "Investment"],
];
const mappingFields = [
  ["original_id", "Original ID"],
  ["transaction_date", "Transaction Date"],
  ["posted_date", "Posted Date"],
  ["description", "Description"],
  ["amount", "Amount"],
  ["debit_amount", "Debit Amount"],
  ["credit_amount", "Credit Amount"],
  ["currency", "Currency"],
  ["counterparty_name", "Counterparty Name"],
  ["counterparty_account_number", "Counterparty Account"],
  ["transaction_type", "Transaction Type"],
  ["variable_symbol", "Variable Symbol"],
  ["specific_symbol", "Specific Symbol"],
  ["constant_symbol", "Constant Symbol"],
  ["counterparty_note", "Counterparty Note"],
  ["my_note", "My Note"],
  ["other_note", "Other Note"],
];
const defaultCategorizationFields = [
  "description",
  "counterparty_name",
  "counterparty_note",
  "my_note",
  "other_note",
  "transaction_type",
];

function emptyFilters() {
  return {
    date_from: "",
    date_to: "",
    bank_account: [],
    category: [],
    subcategory: [],
    want_need_investment: [],
    tag: [],
    q: "",
    include_ignored: false,
  };
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [status, setStatus] = useState("Checking backend");
  const [toast, setToast] = useState("");
  const [refs, setRefs] = useState({
    accounts: [],
    mappings: [],
    categories: [],
    subcategories: [],
    tags: [],
    keywords: [],
  });
  const [filters, setFilters] = useState(emptyFilters);
  const [filterDefaults, setFilterDefaults] = useState({ from: "", to: "" });
  const [summary, setSummary] = useState(null);
  const [transactionPage, setTransactionPage] = useState({ count: 0, results: [] });
  const [recategorizeResult, setRecategorizeResult] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [maintenanceSummary, setMaintenanceSummary] = useState(null);
  const [mappingDraft, setMappingDraft] = useState({
    column_map: {},
    categorization_fields: defaultCategorizationFields,
    detected: null,
  });

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(notify.timeout);
    notify.timeout = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadReferenceData = useCallback(async () => {
    const [accounts, mappings, categories, subcategories, tags, keywords] = await Promise.all([
      apiGet("/bank-accounts/"),
      apiGet("/csv-mappings/"),
      apiGet("/categories/"),
      apiGet("/subcategories/"),
      apiGet("/tags/"),
      apiGet("/keywords/"),
    ]);
    setRefs({ accounts, mappings, categories, subcategories, tags, keywords });
  }, []);

  const loadFilterDefaults = useCallback(async () => {
    const metadata = await apiGet("/transactions/filter-metadata/");
    const nextFrom = metadata.oldest_transaction_date || "";
    const nextTo = metadata.today || todayInputValue();
    setFilterDefaults({ from: nextFrom, to: nextTo });
    setFilters((current) => ({
      ...current,
      date_from: current.date_from || nextFrom,
      date_to: current.date_to || nextTo,
    }));
  }, []);

  const loadAll = useCallback(async () => {
    try {
      await apiGet("/health/");
      setStatus("Backend online");
      await Promise.all([loadReferenceData(), loadFilterDefaults()]);
    } catch (error) {
      setStatus("Backend offline");
      notify(error.message);
    }
  }, [loadFilterDefaults, loadReferenceData, notify]);

  const filterParams = useMemo(() => buildFilterParams(filters), [filters]);

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true);
    try {
      const [nextSummary, nextTransactions] = await Promise.all([
        apiGet("/dashboard/summary/", filterParams),
        apiGet("/transactions/", { ...filterParams, limit: 500 }),
      ]);
      setSummary(nextSummary);
      setTransactionPage(nextTransactions);
    } catch (error) {
      notify(error.message);
    } finally {
      setLoadingDashboard(false);
    }
  }, [filterParams, notify]);

  const loadMaintenance = useCallback(async () => {
    try {
      setMaintenanceSummary(await apiGet("/maintenance/summary/"));
    } catch (error) {
      notify(error.message);
    }
  }, [notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.removeItem("cashmoney-theme");
  }, []);

  useEffect(() => {
    if (filterDefaults.to || filterDefaults.from) {
      loadDashboard();
    }
  }, [filterDefaults, filterParams, loadDashboard]);

  useEffect(() => {
    if (activePage === "maintenance") {
      loadMaintenance();
    }
  }, [activePage, loadMaintenance]);

  const updateFilter = (name, value) => {
    setRecategorizeResult(null);
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const updateTransaction = async (transaction, patch) => {
    const updated = await apiPatch(`/transactions/${transaction.id}/`, patch);
    setTransactionPage((current) => ({
      ...current,
      results: current.results.map((item) => (item.id === updated.id ? updated : item)),
    }));
    await loadDashboard();
    return updated;
  };

  const [title, kicker] = pages[activePage];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">Cashmoney</div>
            <div className="brand-subtitle">Local finance desk</div>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="Primary">
          {Object.entries(pages).map(([key, [label]]) => (
            <button
              className={`nav-tab ${activePage === key ? "is-active" : ""}`}
              key={key}
              onClick={() => setActivePage(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="backend-status">
          <span className={`status-dot ${status === "Backend online" ? "ok" : status === "Backend offline" ? "bad" : ""}`} />
          <span>{status}</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{kicker}</p>
          </div>
          <div className="topbar-actions">
            <a className="link-button" href="/admin/" rel="noreferrer" target="_blank">Admin</a>
            <button className="primary-action" onClick={loadAll} type="button">Refresh</button>
          </div>
        </header>

        {activePage === "dashboard" && (
          <DashboardPage
            filters={filters}
            importBusy={loadingDashboard}
            onFilterChange={updateFilter}
            refs={refs}
            recategorizeResult={recategorizeResult}
            setFilters={setFilters}
            setRecategorizeResult={setRecategorizeResult}
            summary={summary}
            transactionPage={transactionPage}
            updateTransaction={updateTransaction}
            filterParams={filterParams}
            notify={notify}
            reloadDashboard={loadDashboard}
          />
        )}
        {activePage === "import" && (
          <ImportPage importReport={importReport} notify={notify} refs={refs} reloadAll={loadAll} setImportReport={setImportReport} />
        )}
        {activePage === "settings" && (
          <DefinitionsPage
            mappingDraft={mappingDraft}
            notify={notify}
            refs={refs}
            reloadAll={loadAll}
            setMappingDraft={setMappingDraft}
          />
        )}
        {activePage === "maintenance" && (
          <MaintenancePage
            notify={notify}
            reloadAll={loadAll}
            reloadDashboard={loadDashboard}
            reloadMaintenance={loadMaintenance}
            summary={maintenanceSummary}
          />
        )}
      </main>
      <div className={`toast ${toast ? "is-visible" : ""}`}>{toast}</div>
    </div>
  );
}

function DashboardPage({
  filters,
  filterParams,
  importBusy,
  notify,
  onFilterChange,
  recategorizeResult,
  refs,
  reloadDashboard,
  setFilters,
  setRecategorizeResult,
  summary,
  transactionPage,
  updateTransaction,
}) {
  const metrics = useMemo(() => buildMetrics(summary, transactionPage), [summary, transactionPage]);

  async function recategorize() {
    if (!transactionPage.count) {
      notify("No filtered transactions");
      return;
    }
    if (!window.confirm(`Recategorize ${transactionPage.count.toLocaleString()} filtered transactions?`)) {
      return;
    }
    try {
      const result = await apiPost("/transactions/recategorize/", {}, filterParams);
      setRecategorizeResult(result);
      notify(`${Number(result.updated || 0).toLocaleString()} transactions updated`);
      await reloadDashboard();
    } catch (error) {
      notify(error.message);
    }
  }

  return (
    <>
      <section className="filter-panel">
        <div className="filter-bar">
          <DateInput label="From" name="date_from" onChange={onFilterChange} value={filters.date_from} />
          <DateInput label="To" name="date_to" onChange={onFilterChange} value={filters.date_to} />
          <MultiSelect label="Account" name="bank_account" onChange={onFilterChange} options={refs.accounts.map((item) => [item.id, item.name])} value={filters.bank_account} />
          <MultiSelect
            label="Category"
            name="category"
            onChange={onFilterChange}
            options={[[UNASSIGNED, "Unassigned category"], ...refs.categories.map((item) => [item.id, item.name])]}
            value={filters.category}
          />
          <MultiSelect
            label="Subcategory"
            name="subcategory"
            onChange={onFilterChange}
            options={[[UNASSIGNED, "Unassigned subcategory"], ...refs.subcategories.map((item) => [item.id, subLabel(item)])]}
            value={filters.subcategory}
          />
          <MultiSelect
            label="WNI"
            name="want_need_investment"
            onChange={onFilterChange}
            options={[...wniOptions, [UNASSIGNED, "Unassigned"]]}
            value={filters.want_need_investment}
          />
          <MultiSelect
            label="Tag"
            name="tag"
            onChange={onFilterChange}
            options={[[UNASSIGNED, "No tags"], ...refs.tags.map((item) => [item.id, item.name])]}
            value={filters.tag}
          />
          <label className="wide-field">
            <span>Search</span>
            <input onChange={(event) => onFilterChange("q", event.target.value)} placeholder="Description" type="search" value={filters.q} />
          </label>
          <label className="check-row">
            <input checked={filters.include_ignored} onChange={(event) => onFilterChange("include_ignored", event.target.checked)} type="checkbox" />
            <span>Ignored</span>
          </label>
        </div>
        <RelativeRangeForm setFilters={setFilters} />
      </section>

      <section className="panel recategorize-panel">
        <div className="panel-header">
          <h2>Recategorization</h2>
          <span className="muted">{transactionPage.count.toLocaleString()} filtered transactions</span>
        </div>
        <div className="recategorize-body">
          <div className="recategorize-scope">
            <span>Filtered Scope</span>
            <strong>{transactionPage.count.toLocaleString()} transactions</strong>
          </div>
          <button className="primary-action" disabled={!transactionPage.count || importBusy} onClick={recategorize} type="button">Recategorize Filtered</button>
        </div>
        {recategorizeResult && <RecategorizeStats result={recategorizeResult} />}
      </section>

      <div className="metrics-grid">
        {metrics.map(([label, value, tone]) => (
          <div className="metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className={`metric-value ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-charts">
        <ChartPanel className="chart-panel-wide" title="Monthly Flow"><MonthlyChart rows={summary?.monthly || []} /></ChartPanel>
        <ChartPanel title="Income Categories"><SunburstChart rows={summary?.income_categories || []} label="Income" /></ChartPanel>
        <ChartPanel title="Expense Categories"><SunburstChart rows={summary?.expense_categories || []} label="Expenses" /></ChartPanel>
        <ChartPanel title="Want / Need / Investment"><WniChart rows={summary?.want_need_investment || []} /></ChartPanel>
        <ChartPanel title="Top Expense Subcategories"><TopExpenseChart rows={summary?.expense_categories || []} /></ChartPanel>
      </div>

      <section className="panel transaction-panel">
        <div className="panel-header">
          <h2>Transactions</h2>
          <span className="muted">{transactionPage.count.toLocaleString()} shown</span>
        </div>
        <TransactionGrid notify={notify} refs={refs} rows={transactionPage.results} updateTransaction={updateTransaction} />
      </section>
    </>
  );
}

function TransactionGrid({ notify, refs, rows, updateTransaction }) {
  const subcategoryOptions = useMemo(() => ["", ...refs.subcategories.map((item) => item.id)], [refs.subcategories]);
  const subcategoryLookup = useMemo(() => new Map(refs.subcategories.map((item) => [item.id, item])), [refs.subcategories]);
  const categoryLookup = useMemo(() => new Map(refs.categories.map((item) => [item.id, item])), [refs.categories]);
  const accountLookup = useMemo(() => new Map(refs.accounts.map((item) => [item.id, item.name])), [refs.accounts]);

  const rowData = useMemo(() => rows.map((row) => ({
    ...row,
    account_id: row.bank_account?.id || "",
    subcategory_id: row.subcategory?.id || "",
  })), [rows]);

  const columnDefs = useMemo(() => [
    { field: "transaction_date", headerName: "Date", width: 120, sort: "desc" },
    { field: "description", headerName: "Description", flex: 2, minWidth: 260, wrapText: true, autoHeight: true },
    {
      cellClass: (params) => (Number(params.value) >= 0 ? "amount-income" : "amount-expense"),
      field: "amount",
      headerName: "Amount",
      valueFormatter: (params) => amountNumber(params.value),
      width: 130,
    },
    {
      field: "account_id",
      headerName: "Account",
      valueFormatter: (params) => accountLookup.get(params.value) || "",
      width: 180,
    },
    {
      field: "category",
      headerName: "Category",
      cellRenderer: (params) => {
        const category = categoryLookup.get(params.value?.id);
        return <ColorCell color={category?.color} label={params.value?.name || "Unassigned"} muted={!params.value} />;
      },
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 150,
    },
    {
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: subcategoryOptions },
      editable: true,
      field: "subcategory_id",
      headerName: "Subcategory",
      cellRenderer: (params) => {
        const subcategory = subcategoryLookup.get(params.value);
        return <ColorCell color={subcategory?.color} label={subcategory?.name || "Unassigned"} muted={!subcategory} />;
      },
      valueFormatter: (params) => {
        const subcategory = subcategoryLookup.get(params.value);
        return subcategory?.name || "Unassigned";
      },
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 170,
    },
    {
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["", "want", "need", "investment"] },
      editable: true,
      field: "want_need_investment",
      headerName: "WNI",
      cellRenderer: (params) => <WniCell value={params.value} />,
      valueFormatter: (params) => (params.value ? titleCase(params.value) : "Unassigned"),
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 135,
    },
    {
      field: "tags",
      headerName: "Tags",
      cellRenderer: (params) => (
        <EditableTagCell
          allTags={refs.tags}
          notify={notify}
          row={params.data}
          tags={params.value || []}
          updateTransaction={updateTransaction}
        />
      ),
      sortable: false,
      flex: 1,
      minWidth: 240,
    },
    {
      field: "is_ignored",
      headerName: "Ignored",
      cellRenderer: (params) => (
        <input
          checked={Boolean(params.value)}
          onChange={async (event) => {
            try {
              await updateTransaction(params.data, { is_ignored: event.target.checked });
              notify("Transaction saved");
            } catch (error) {
              notify(error.message);
            }
          }}
          type="checkbox"
        />
      ),
      width: 110,
    },
  ], [accountLookup, categoryLookup, notify, refs.tags, subcategoryLookup, subcategoryOptions, updateTransaction]);

  async function onCellValueChanged(event) {
    if (event.oldValue === event.newValue || !["subcategory_id", "want_need_investment"].includes(event.colDef.field)) {
      return;
    }
    const patch = event.colDef.field === "subcategory_id"
      ? { subcategory_id: event.newValue || "" }
      : { want_need_investment: event.newValue || "" };
    try {
      await updateTransaction(event.data, patch);
      notify("Transaction saved");
    } catch (error) {
      event.node.setDataValue(event.colDef.field, event.oldValue);
      notify(error.message);
    }
  }

  return (
    <div className="ag-theme-quartz transaction-grid">
      <AgGridReact
        columnDefs={columnDefs}
        defaultColDef={{ resizable: true, sortable: true }}
        onCellValueChanged={onCellValueChanged}
        rowData={rowData}
        rowHeight={48}
        stopEditingWhenCellsLoseFocus
      />
    </div>
  );
}

function ImportPage({ importReport, notify, refs, reloadAll, setImportReport }) {
  async function submitImport(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/imports/", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Import failed");
      }
      setImportReport(payload.report);
      event.currentTarget.reset();
      notify("CSV imported");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    }
  }

  return (
    <section className="panel import-layout">
      <form className="stack-form" onSubmit={submitImport}>
        <label><span>CSV file</span><input accept=".csv,text/csv" name="csv_file" required type="file" /></label>
        <label><span>Bank account</span><Select name="bank_account_id" options={refs.accounts.map((item) => [item.id, item.name])} required /></label>
        <label><span>CSV mapping</span><Select blank="Account default" name="csv_mapping_id" options={refs.mappings.map((item) => [item.id, item.name])} /></label>
        <button className="primary-action" type="submit">Import CSV</button>
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

function MaintenancePage({ notify, reloadAll, reloadDashboard, reloadMaintenance, summary }) {
  const [deleting, setDeleting] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [safeBusy, setSafeBusy] = useState("");
  const counts = summary || {};
  const snapshot = [
    ["Transactions", counts.transactions],
    ["Imports", counts.imports],
    ["Sample Transactions", counts.sample_transactions],
    ["Accounts", counts.bank_accounts],
    ["CSV Mappings", counts.csv_mappings],
    ["Categories", counts.categories],
    ["Subcategories", counts.subcategories],
    ["Tags", counts.tags],
    ["Keywords", counts.keywords],
  ];
  const financeObjectCount = [
    counts.transactions,
    counts.imports,
    counts.bank_accounts,
    counts.csv_mappings,
    counts.categories,
    counts.subcategories,
    counts.tags,
    counts.keywords,
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
    setDeleting(true);
    try {
      await apiDelete(action.endpoint, { confirmation: action.phrase });
      notify(`${action.title} completed`);
      await Promise.all([reloadMaintenance(), reloadAll(), reloadDashboard()]);
    } catch (error) {
      notify(error.message);
    } finally {
      setDeleting(false);
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
          <button className="link-button" onClick={reloadMaintenance} type="button">Refresh Counts</button>
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
            <button className="primary-action" disabled={Boolean(safeBusy)} onClick={exportBackup} type="button">
              Export Backup
            </button>
          </article>
          <article className="maintenance-tool-card">
            <div>
              <h3>Recreate sample data</h3>
              <p>Reset only the sample dataset and create the demo records again.</p>
            </div>
            <button className="link-button" disabled={Boolean(safeBusy)} onClick={recreateSampleData} type="button">
              Recreate Samples
            </button>
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
              <button
                className="danger-button"
                disabled={Boolean(safeBusy) || !restoreFile}
                type="submit"
              >
                Restore Database
              </button>
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
          {actions.map((action) => (
            <article className="danger-card" key={action.phrase}>
              <div>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
                <div className="danger-count">{formatCount(action.count)} affected</div>
              </div>
              <button className="danger-button" disabled={deleting} onClick={() => deleteMaintenanceData(action)} type="button">
                {action.title}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function DefinitionsPage({ mappingDraft, notify, refs, reloadAll, setMappingDraft }) {
  return (
    <div className="settings-grid">
      <DefinitionPanel endpoint="/bank-accounts/" formatter={(item) => [item.name, `${item.bank_name || "Bank"} - ${item.account_number}`]} items={refs.accounts} title="Bank Accounts">
        <AccountForm notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/csv-mappings/" formatter={(item) => [item.name, `${item.delimiter} - ${item.date_format}`]} items={refs.mappings} title="CSV Mappings">
        <MappingForm draft={mappingDraft} notify={notify} reloadAll={reloadAll} setDraft={setMappingDraft} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/categories/" formatter={(item) => [item.name, item.description || ""]} items={refs.categories} title="Categories">
        <SimpleForm endpoint="/categories/" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/subcategories/" formatter={(item) => [item.name, item.category?.name || ""]} items={refs.subcategories} title="Subcategories">
        <SubcategoryForm notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/tags/" formatter={(item) => [item.name, item.description || ""]} items={refs.tags} title="Tags">
        <SimpleForm endpoint="/tags/" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/keywords/" formatter={(item) => [item.name, `${(item.include_terms || []).join(", ")} - ${item.subcategory?.name || "No subcategory"} - ${item.want_need_investment || "No WNI"}`]} items={refs.keywords} title="Keywords" wide>
        <KeywordForm notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
    </div>
  );
}

function DefinitionPanel({ children, endpoint, formatter, items, title, wide = false }) {
  return (
    <section className={`panel ${wide ? "wide-panel" : ""}`}>
      <div className="panel-header"><h2>{title}</h2></div>
      {children}
      <div className="item-list">
        {items.length ? items.map((item) => {
          const [itemTitle, subtitle] = formatter(item);
          return (
            <div className="item-row" key={item.id}>
              <div>
                <div className="item-title">{itemTitle}</div>
                <div className="item-subtitle">{subtitle}</div>
              </div>
              <div className="item-actions">
                {item.color && <span className="swatch" style={{ background: item.color }} />}
                <DeleteButton endpoint={`${endpoint}${item.id}/`} name={itemTitle} />
              </div>
            </div>
          );
        }) : <div className="muted">No records yet.</div>}
      </div>
    </section>
  );
}

function DeleteButton({ endpoint, name }) {
  async function remove() {
    if (!window.confirm(`Delete ${name}?`)) {
      return;
    }
    await apiDelete(endpoint);
    window.location.reload();
  }
  return <button className="delete-button" onClick={remove} type="button">Delete</button>;
}

function AccountForm({ notify, refs, reloadAll }) {
  async function submit(event) {
    event.preventDefault();
    const data = formObject(event.currentTarget);
    data.owners = Number(data.owners || 1);
    try {
      await apiPost("/bank-accounts/", data);
      event.currentTarget.reset();
      notify("Account added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    }
  }
  return (
    <form className="compact-form" onSubmit={submit}>
      <input name="name" placeholder="Name" required />
      <input name="account_number" placeholder="Account number" required />
      <input name="bank_name" placeholder="Bank" />
      <input defaultValue="CZK" name="currency" placeholder="Currency" />
      <input defaultValue="1" min="1" name="owners" type="number" />
      <Select blank="No default mapping" name="default_csv_mapping_id" options={refs.mappings.map((item) => [item.id, item.name])} />
      <button type="submit">Add</button>
    </form>
  );
}

function MappingForm({ draft, notify, reloadAll, setDraft }) {
  const headers = draft.detected?.headers || [];

  async function detectColumns(event) {
    event.preventDefault();
    const form = event.currentTarget.form || event.currentTarget;
    const file = form.elements.sample_csv.files[0];
    if (!file) {
      notify("Choose a sample CSV");
      return;
    }
    const formData = new FormData();
    formData.append("csv_file", file);
    ["delimiter", "quotechar", "encoding", "header_row", "date_format", "decimal_separator", "thousands_separator", "default_currency"].forEach((field) => {
      formData.append(field, form.elements[field]?.value || "");
    });
    try {
      const response = await fetch("/api/csv-mappings/detect-columns/", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Column detection failed");
      }
      setDraft({
        detected: payload,
        column_map: guessColumnMap(payload.headers),
        categorization_fields: defaultCategorizationFields,
      });
      notify(`Detected ${payload.headers.length} columns`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const data = formObject(event.currentTarget);
    data.header_row = Number(data.header_row || 0);
    data.column_map = draft.column_map;
    data.categorization_fields = draft.categorization_fields;
    data.fallback_date_formats = [];
    try {
      await apiPost("/csv-mappings/", data);
      event.currentTarget.reset();
      setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, detected: null });
      notify("CSV mapping added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    }
  }

  return (
    <form className="compact-form mapping-form" onSubmit={submit}>
      <input name="name" placeholder="Name" required />
      <input defaultValue="," name="delimiter" placeholder="Delimiter" />
      <input defaultValue="%Y-%m-%d" name="date_format" placeholder="Date format" />
      <input defaultValue="CZK" name="default_currency" placeholder="Currency" />
      <input defaultValue="utf-8-sig" name="encoding" placeholder="Encoding" />
      <input defaultValue="0" min="0" name="header_row" placeholder="Header row" type="number" />
      <input defaultValue={'"'} name="quotechar" placeholder="Quote" />
      <input defaultValue="." name="decimal_separator" placeholder="Decimal" />
      <input name="thousands_separator" placeholder="Thousands" />
      <label className="mapping-file-field"><span>Sample CSV</span><input accept=".csv,text/csv" name="sample_csv" type="file" /></label>
      <button className="link-button" onClick={detectColumns} type="button">Detect Columns</button>
      <div className="mapping-column-map">
        {mappingFields.map(([key, label]) => (
          <label className="mapping-column-field" key={key}>
            <span>{label}</span>
            <select
              multiple={key === "description"}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean);
                setDraft((current) => ({
                  ...current,
                  column_map: { ...current.column_map, [key]: event.target.multiple ? selected : selected[0] || "" },
                }));
              }}
              value={key === "description" ? coerceArray(draft.column_map[key]) : draft.column_map[key] || ""}
            >
              <option value="">Not mapped</option>
              {headers.map((header) => <option key={header} value={header}>{header}</option>)}
            </select>
          </label>
        ))}
      </div>
      <label className="mapping-categorization-field">
        <span>Categorization Fields</span>
        <select
          multiple
          onChange={(event) => setDraft((current) => ({ ...current, categorization_fields: Array.from(event.target.selectedOptions).map((option) => option.value) }))}
          value={draft.categorization_fields}
        >
          {mappingFields.filter(([key]) => !["original_id", "transaction_date", "posted_date", "amount", "debit_amount", "credit_amount", "currency"].includes(key)).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>
      {draft.detected && <MappingSample detected={draft.detected} />}
      <button type="submit">Add</button>
    </form>
  );
}

function MappingSample({ detected }) {
  const rows = detected.sample_rows || [];
  return (
    <div className="mapping-sample">
      <div className="mapping-sample-meta">{detected.loaded} rows detected. Showing {rows.length} samples.</div>
      <div className="mapping-sample-table">
        <table>
          <thead><tr>{detected.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.line}>{detected.headers.map((header) => <td key={header}>{row.raw[header]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SimpleForm({ endpoint, fields, notify, reloadAll }) {
  async function submit(event) {
    event.preventDefault();
    try {
      await apiPost(endpoint, formObject(event.currentTarget));
      event.currentTarget.reset();
      notify("Record added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    }
  }
  return (
    <form className="compact-form" onSubmit={submit}>
      {fields.map(([name, placeholder, required]) => <input key={name} name={name} placeholder={placeholder} required={required} />)}
      <button type="submit">Add</button>
    </form>
  );
}

function SubcategoryForm({ notify, refs, reloadAll }) {
  async function submit(event) {
    event.preventDefault();
    try {
      await apiPost("/subcategories/", formObject(event.currentTarget));
      event.currentTarget.reset();
      notify("Subcategory added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    }
  }
  return (
    <form className="compact-form" onSubmit={submit}>
      <Select name="category_id" options={refs.categories.map((item) => [item.id, item.name])} required />
      <input name="name" placeholder="Name" required />
      <input name="color" placeholder="Color" />
      <button type="submit">Add</button>
    </form>
  );
}

function KeywordForm({ notify, refs, reloadAll }) {
  async function submit(event) {
    event.preventDefault();
    const data = formObject(event.currentTarget);
    data.include_terms = lines(data.include_terms);
    data.exclude_terms = lines(data.exclude_terms);
    data.priority = Number(data.priority || 0);
    data.is_ignored = Boolean(event.currentTarget.elements.is_ignored.checked);
    data.tag_ids = Array.from(event.currentTarget.elements.tag_ids.selectedOptions).map((option) => option.value);
    try {
      await apiPost("/keywords/", data);
      event.currentTarget.reset();
      notify("Keyword added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    }
  }
  return (
    <form className="compact-form keyword-form" onSubmit={submit}>
      <input name="name" placeholder="Name" required />
      <textarea name="include_terms" placeholder="Include terms, one per line" required rows="3" />
      <textarea name="exclude_terms" placeholder="Exclude terms, one per line" rows="3" />
      <Select blank="No subcategory" name="subcategory_id" options={refs.subcategories.map((item) => [item.id, subLabel(item)])} />
      <Select blank="No WNI" name="want_need_investment" options={wniOptions} />
      <select multiple name="tag_ids">{refs.tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input defaultValue="0" name="priority" type="number" />
      <label className="check-row"><input name="is_ignored" type="checkbox" /><span>Ignore matches</span></label>
      <button type="submit">Add</button>
    </form>
  );
}

function ChartPanel({ children, className = "", title }) {
  return <section className={`panel chart-panel ${className}`}><div className="panel-header"><h2>{title}</h2></div>{children}</section>;
}

function MonthlyChart({ rows }) {
  const monthlyRows = completeMonthlyRows(rows);
  if (!monthlyRows.length) return <EmptyChart />;
  const months = monthlyRows.map((row) => row.month);
  const incomes = monthlyRows.map((row) => row.income);
  const expenses = monthlyRows.map((row) => -row.expense);
  const net = monthlyRows.map((row) => row.net);
  const barWidth = monthlyRows.map(() => 0.78);
  const netColors = monthlyRows.map(() => "rgba(0, 0, 0, 0.22)");
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[
        {
          customdata: monthlyRows.map((row) => [row.expense, row.net]),
          hovertemplate: "Month: %{x}<br>Income: %{y:,.0f}<br>Expenses: %{customdata[0]:,.0f}<br>Net: %{customdata[1]:,.0f}<extra></extra>",
          marker: { color: cssVar("--green", "#2f8f65") },
          name: "Income",
          type: "bar",
          width: barWidth,
          x: months,
          y: incomes,
        },
        {
          customdata: monthlyRows.map((row) => [row.expense, row.net]),
          hovertemplate: "Month: %{x}<br>Expenses: %{customdata[0]:,.0f}<br>Net: %{customdata[1]:,.0f}<extra></extra>",
          marker: { color: cssVar("--red", "#dc2626") },
          name: "Expenses",
          type: "bar",
          width: barWidth,
          x: months,
          y: expenses,
        },
        {
          customdata: monthlyRows.map((row) => [row.income, row.expense]),
          hovertemplate: "Month: %{x}<br>Net: %{y:,.0f}<br>Income: %{customdata[0]:,.0f}<br>Expenses: %{customdata[1]:,.0f}<extra></extra>",
          marker: {
            color: netColors,
            line: { width: 0 },
          },
          name: "Net",
          type: "bar",
          width: barWidth,
          x: months,
          y: net,
        },
      ]}
      layout={baseLayout({
        bargap: 0.24,
        barmode: "overlay",
        hovermode: "x unified",
        xaxis: { type: "category" },
        yaxis: { zeroline: true, zerolinecolor: cssVar("--border", "#9facb5"), zerolinewidth: 1 },
      })}
      useResizeHandler
    />
  );
}

function SunburstChart({ label, rows }) {
  if (!rows.length) return <EmptyChart />;
  const { colors, ids, labels, parents, values } = sunburstData(rows);
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{ branchvalues: "total", ids, labels, marker: { colors }, parents, type: "sunburst", values }]}
      layout={baseLayout({ extendsunburstcolors: false, margin: { t: 8, r: 8, b: 8, l: 8 }, title: undefined })}
      useResizeHandler
    />
  );
}

function WniChart({ rows }) {
  const cleanRows = rows.filter((row) => row.amount > 0);
  if (!cleanRows.length) return <EmptyChart />;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        hole: 0.48,
        labels: cleanRows.map((row) => titleCase(row.name)),
        marker: { colors: cleanRows.map((row) => wniColor(row.name)) },
        type: "pie",
        values: cleanRows.map((row) => row.amount),
      }]}
      layout={baseLayout({ margin: { t: 8, r: 8, b: 8, l: 8 }, showlegend: true })}
      useResizeHandler
    />
  );
}

function TopExpenseChart({ rows }) {
  const topRows = topExpenseSubcategories(rows);
  if (!topRows.length) return <EmptyChart />;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        marker: { color: cssVar("--blue", "#2f6f9f") },
        orientation: "h",
        text: topRows.map((row) => money(row.amount)),
        textposition: "auto",
        type: "bar",
        x: topRows.map((row) => row.amount),
        y: topRows.map((row) => row.label),
      }]}
      layout={baseLayout({
        height: 285,
        margin: { t: 8, r: 18, b: 36, l: 150 },
        xaxis: {},
        yaxis: { automargin: true },
      })}
      useResizeHandler
    />
  );
}

function EmptyChart() {
  return <div className="chart-empty">No data</div>;
}

function RecategorizeStats({ result }) {
  return (
    <div className="recategorize-stats">
      {[
        ["Processed", result.processed],
        ["Updated", result.updated],
        ["Unchanged", result.unchanged],
        ["Uncategorized", result.uncategorized],
        ["Conflicts", result.conflicts],
        ["Skipped", result.skipped_no_mapping],
      ].map(([label, value]) => <Metric key={label} label={label} value={Number(value || 0).toLocaleString()} />)}
    </div>
  );
}

function RelativeRangeForm({ setFilters }) {
  const [count, setCount] = useState(10);
  const [unit, setUnit] = useState("months");
  function submit(event) {
    event.preventDefault();
    const to = new Date();
    const from = subtractRelativeDate(to, Math.max(1, Number(count || 1)), unit);
    setFilters((current) => ({
      ...current,
      date_from: formatDateInput(from),
      date_to: formatDateInput(to),
    }));
  }
  return (
    <form className="relative-range-form" onSubmit={submit}>
      <label><span>Last</span><input min="1" onChange={(event) => setCount(event.target.value)} step="1" type="number" value={count} /></label>
      <label><span>Unit</span><select onChange={(event) => setUnit(event.target.value)} value={unit}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label>
      <button className="link-button" type="submit">Show</button>
    </form>
  );
}

function DateInput({ label, name, onChange, value }) {
  return <label><span>{label}</span><input onChange={(event) => onChange(name, event.target.value)} type="date" value={value} /></label>;
}

function MultiSelect({ label, name, onChange, options, value }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const selectedValues = value || [];
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedOptions = useMemo(
    () => selectedValues
      .map((selectedValue) => options.find(([optionValue]) => optionValue === selectedValue))
      .filter(Boolean),
    [options, selectedValues],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeName(query);
    if (!normalizedQuery) {
      return options;
    }
    return options.filter(([, text]) => normalizeName(text).includes(normalizedQuery));
  }, [options, query]);
  const placeholder = `All ${label.toLowerCase()}${label === "WNI" ? "" : "s"}`;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function toggleOption(optionValue) {
    const next = selectedSet.has(optionValue)
      ? selectedValues.filter((item) => item !== optionValue)
      : [...selectedValues, optionValue];
    onChange(name, next);
  }

  function removeOption(event, optionValue) {
    event.stopPropagation();
    onChange(name, selectedValues.filter((item) => item !== optionValue));
  }

  return (
    <div className="filter-multiselect" ref={rootRef}>
      <span className="filter-label">{label}</span>
      <button
        aria-expanded={isOpen}
        className={`filter-multiselect-control ${isOpen ? "is-open" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className={`filter-chip-list ${selectedOptions.length ? "" : "is-empty"}`}>
          {selectedOptions.length ? selectedOptions.map(([optionValue, text]) => (
            <span className="filter-chip" key={optionValue}>
              <span title={text}>{text}</span>
              <span
                aria-label={`Remove ${text}`}
                className="filter-chip-remove"
                onClick={(event) => removeOption(event, optionValue)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    removeOption(event, optionValue);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                x
              </span>
            </span>
          )) : placeholder}
        </span>
        <span className="filter-chevron">▾</span>
      </button>
      {isOpen && (
        <div className="filter-multiselect-menu">
          <div className="filter-menu-header">
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              type="search"
              value={query}
            />
            {selectedValues.length > 0 && (
              <button className="filter-clear" onClick={() => onChange(name, [])} type="button">Clear</button>
            )}
          </div>
          <div className="filter-option-list">
            {filteredOptions.length ? filteredOptions.map(([optionValue, text]) => {
              const selected = selectedSet.has(optionValue);
              return (
                <button
                  className={`filter-option ${selected ? "is-selected" : ""}`}
                  key={optionValue}
                  onClick={() => toggleOption(optionValue)}
                  title={text}
                  type="button"
                >
                  <span className="filter-option-check">{selected ? "✓" : ""}</span>
                  <span>{text}</span>
                </button>
              );
            }) : <div className="filter-no-matches">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Select({ blank, name, options, required = false }) {
  return (
    <select name={name} required={required}>
      {blank && <option value="">{blank}</option>}
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

function Metric({ label, tone = "", value }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className={`metric-value ${tone}`}>{value}</div></div>;
}

function ColorPill({ color, label, muted = false }) {
  if (muted) {
    return <span className="pill muted-pill">{label}</span>;
  }
  return <span className="pill color-pill" style={colorPillStyle(color)}>{label}</span>;
}

function ColorCell({ color, label, muted = false }) {
  if (muted) {
    return <span className="color-cell color-cell-muted">{label}</span>;
  }
  return <span className="color-cell" style={colorPillStyle(color)}>{label}</span>;
}

function WniCell({ value }) {
  if (!value) {
    return <span className="color-cell color-cell-muted">Unassigned</span>;
  }
  return <span className="color-cell" style={colorPillStyle(wniColor(value))}>{titleCase(value)}</span>;
}

function EditableTagCell({ allTags, notify, row, tags, updateTransaction }) {
  const [draftIds, setDraftIds] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0 });
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const rootRef = useRef(null);
  const selectedIds = useMemo(() => tags.map((tag) => tag.id), [tags]);
  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const selectedDraftTags = useMemo(
    () => draftIds.map((id) => allTags.find((tag) => tag.id === id)).filter(Boolean),
    [allTags, draftIds],
  );
  const filteredTags = useMemo(() => {
    const normalizedQuery = normalizeName(query);
    if (!normalizedQuery) {
      return allTags;
    }
    return allTags.filter((tag) => normalizeName(tag.name).includes(normalizedQuery));
  }, [allTags, query]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      const clickedCell = rootRef.current?.contains(event.target);
      const clickedPopover = popoverRef.current?.contains(event.target);
      if (!clickedCell && !clickedPopover) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function updatePosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const popoverWidth = 360;
      const popoverHeight = 340;
      const left = Math.min(
        Math.max(12, rect.left),
        Math.max(12, window.innerWidth - popoverWidth - 12),
      );
      const preferredTop = rect.bottom + 6;
      const top = preferredTop + popoverHeight > window.innerHeight && rect.top > popoverHeight
        ? rect.top - popoverHeight - 6
        : preferredTop;
      setPopoverPosition({ left, top: Math.max(12, top) });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  function openEditor() {
    setDraftIds(selectedIds);
    setQuery("");
    setIsOpen(true);
  }

  function stopGridEvent(event) {
    event.stopPropagation();
  }

  function toggleTag(tagId) {
    setDraftIds((current) => (
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    ));
  }

  async function applyTags() {
    setSaving(true);
    try {
      await updateTransaction(row, { tag_ids: draftIds });
      notify("Transaction tags saved");
      setIsOpen(false);
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tag-edit-cell" onClick={stopGridEvent} onDoubleClick={stopGridEvent} onMouseDown={stopGridEvent} ref={rootRef}>
      <button className="tag-cell-button" onClick={openEditor} ref={buttonRef} title={tagTitle(tags)} type="button">
        <TagCloud tags={tags} />
      </button>
      {isOpen && (
        <div className="tag-popover" onClick={stopGridEvent} onDoubleClick={stopGridEvent} onMouseDown={stopGridEvent} ref={popoverRef} style={{ left: popoverPosition.left, top: popoverPosition.top }}>
          <div className="tag-popover-selected">
            {selectedDraftTags.length ? <TagCloud collapse={false} tags={selectedDraftTags} /> : <span className="muted">No tags selected</span>}
          </div>
          <input
            autoFocus
            className="tag-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tags"
            type="search"
            value={query}
          />
          <div className="tag-option-list">
            {filteredTags.length ? filteredTags.map((tag) => (
              <button className={`tag-option ${selectedSet.has(tag.id) ? "is-selected" : ""}`} key={tag.id} onClick={() => toggleTag(tag.id)} type="button">
                <span className="tag-option-check">{selectedSet.has(tag.id) ? "✓" : ""}</span>
                <span className="pill tag-pill" style={colorPillStyle(tag.color)}>{tag.name}</span>
              </button>
            )) : <div className="tag-no-matches">No matches</div>}
          </div>
          <div className="tag-popover-actions">
            <button className="link-button" disabled={saving} onClick={() => setIsOpen(false)} type="button">Cancel</button>
            <button className="primary-action" disabled={saving} onClick={applyTags} type="button">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TagCloud({ collapse = true, tags }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const visibleCount = useMemo(() => (collapse ? estimateVisibleTagCount(tags, width) : tags.length), [collapse, tags, width]);
  const visibleTags = tags.slice(0, visibleCount);
  const hiddenCount = Math.max(tags.length - visibleCount, 0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    function updateWidth() {
      setWidth(element.clientWidth);
    }
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="tag-cloud" ref={containerRef} title={tagTitle(tags)}>
      {visibleTags.map((tag) => <span className="pill tag-pill" key={tag.id} style={colorPillStyle(tag.color)}>{tag.name}</span>)}
      {hiddenCount > 0 && <span className="pill tag-more-pill">+{hiddenCount}</span>}
    </div>
  );
}

function buildFilterParams(filters) {
  const params = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (key === "include_ignored") return;
    if (Array.isArray(value) ? value.length : value) {
      params[key] = value;
    }
  });
  if (filters.include_ignored) {
    params.include_ignored = "true";
  }
  return params;
}

function buildMetrics(summary, transactionPage) {
  const monthly = summary?.monthly || [];
  const income = monthly.reduce((acc, row) => acc + Number(row.income || 0), 0);
  const expense = monthly.reduce((acc, row) => acc + Number(row.expense || 0), 0);
  const uncategorized = (transactionPage.results || []).filter((row) => !row.category && !row.is_ignored).length;
  return [
    ["Income", money(income), "positive"],
    ["Expenses", money(expense), "negative"],
    ["Net", money(income - expense), income - expense >= 0 ? "positive" : "negative"],
    ["Transactions", transactionPage.count.toLocaleString(), ""],
    ["Uncategorized", uncategorized.toLocaleString(), ""],
  ];
}

function baseLayout(extra = {}) {
  const axisDefaults = {
    color: cssVar("--muted", "#667481"),
    gridcolor: cssVar("--border", "#d8e0e5"),
    linecolor: cssVar("--border", "#d8e0e5"),
    tickcolor: cssVar("--border", "#d8e0e5"),
    zerolinecolor: cssVar("--border", "#d8e0e5"),
  };
  const xaxis = { ...axisDefaults, ...(extra.xaxis || {}) };
  const yaxis = { ...axisDefaults, ...(extra.yaxis || {}) };
  return {
    autosize: true,
    colorway: [
      cssVar("--blue", "#2f6f9f"),
      cssVar("--orange", "#c96e26"),
      cssVar("--green", "#2f8f65"),
      cssVar("--violet", "#7655a6"),
      cssVar("--warning", "#b1842f"),
      cssVar("--red", "#b34545"),
    ],
    font: { color: cssVar("--text", "#17212b"), family: "Inter, Segoe UI, sans-serif" },
    height: 285,
    hoverlabel: {
      bgcolor: cssVar("--surface", "#ffffff"),
      bordercolor: cssVar("--border", "#d8e0e5"),
      font: { color: cssVar("--text", "#17212b") },
    },
    legend: {
      font: { color: cssVar("--text", "#17212b") },
    },
    margin: { t: 24, r: 20, b: 42, l: 54 },
    paper_bgcolor: "rgba(255,255,255,0)",
    plot_bgcolor: "rgba(255,255,255,0)",
    ...extra,
    xaxis,
    yaxis,
  };
}

function cssVar(name, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function wniColor(value) {
  const colors = {
    investment: cssVar("--wni-investment", "#059669"),
    need: cssVar("--wni-need", "#2563eb"),
    uncategorized: cssVar("--wni-uncategorized", "#64748b"),
    want: cssVar("--wni-want", "#f59e0b"),
  };
  return colors[String(value || "uncategorized").toLowerCase()] || colors.uncategorized;
}

function sunburstData(rows) {
  const colors = [];
  const ids = [];
  const labels = [];
  const parents = [];
  const values = [];
  rows.forEach((category) => {
    const categoryId = `category:${category.name}`;
    ids.push(categoryId);
    labels.push(category.name);
    parents.push("");
    values.push(category.amount);
    colors.push(normalizeHexColor(category.color) || cssVar("--muted", "#667481"));
    (category.children || []).forEach((child) => {
      ids.push(`${categoryId}:${child.name}`);
      labels.push(child.name);
      parents.push(categoryId);
      values.push(child.amount);
      colors.push(normalizeHexColor(child.color) || normalizeHexColor(category.color) || cssVar("--surface-2", "#eef3f6"));
    });
  });
  return { colors, ids, labels, parents, values };
}

function topExpenseSubcategories(rows) {
  return rows
    .flatMap((category) => (category.children || []).map((child) => ({
      amount: Number(child.amount || 0),
      label: `${category.name} / ${child.name}`,
    })))
    .filter((row) => row.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 8)
    .reverse();
}

function completeMonthlyRows(rows) {
  const cleanRows = rows
    .map((row) => ({
      expense: Number(row.expense || 0),
      income: Number(row.income || 0),
      month: String(row.month || ""),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month))
    .sort((left, right) => left.month.localeCompare(right.month));

  if (!cleanRows.length) {
    return [];
  }

  const byMonth = new Map(cleanRows.map((row) => [row.month, row]));
  const [startYear, startMonth] = cleanRows[0].month.split("-").map(Number);
  const [endYear, endMonth] = cleanRows[cleanRows.length - 1].month.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, 1);
  const end = new Date(endYear, endMonth - 1, 1);
  const completed = [];

  while (cursor <= end) {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const row = byMonth.get(month) || { expense: 0, income: 0, month };
    completed.push({
      ...row,
      net: row.income - row.expense,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return completed;
}

function formObject(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (!key.startsWith("sample_")) {
      data[key] = value;
    }
  });
  return data;
}

function guessColumnMap(headers) {
  const normalized = headers.map((header) => [header, normalizeName(header)]);
  const aliases = {
    original_id: ["id", "identifikacetransakce", "transactionid"],
    transaction_date: ["date", "datumzauctovani", "datum"],
    posted_date: ["posted", "datumprovedeni"],
    description: ["description", "popis", "nazevprotiuctu"],
    amount: ["amount", "castka"],
    currency: ["currency", "mena"],
    counterparty_name: ["counterparty", "nazevprotiuctu"],
    counterparty_account_number: ["protistrana", "counterpartyaccount"],
    transaction_type: ["typtransakce", "type"],
    variable_symbol: ["vs", "variablesymbol"],
    specific_symbol: ["ss", "specificsymbol"],
    constant_symbol: ["ks", "constantsymbol"],
    counterparty_note: ["zpravaprijemce", "messageforrecipient"],
    my_note: ["popisprome", "mynote"],
    other_note: ["referenceplatby", "othernote"],
  };
  return Object.fromEntries(mappingFields.map(([key]) => {
    const match = normalized.find(([, name]) => (aliases[key] || []).some((alias) => name.includes(alias)));
    return [key, match?.[0] || ""];
  }));
}

function normalizeName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function coerceArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function lines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function subLabel(item) {
  return `${item.category?.name || "No category"} / ${item.name}`;
}

function money(value) {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function amountNumber(value) {
  return formatNumber(value, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("en-US", options).format(Number(value || 0)).replace(/,/g, " ");
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function colorPillStyle(color) {
  const background = normalizeHexColor(color);
  if (!background) {
    return undefined;
  }
  return {
    background,
    borderColor: background,
    color: readableTextColor(background),
  };
}

function tagTitle(tags) {
  return tags.length ? tags.map((tag) => tag.name).join(", ") : "No tags";
}

function estimateVisibleTagCount(tags, width) {
  if (!tags.length) {
    return 0;
  }
  if (!width) {
    return Math.min(tags.length, 2);
  }

  const gap = 4;
  const morePillWidth = 42;
  let usedWidth = 0;
  let visibleCount = 0;

  for (const tag of tags) {
    const pillWidth = estimateTagPillWidth(tag.name);
    const nextWidth = usedWidth + (visibleCount ? gap : 0) + pillWidth;
    const hasHiddenAfterThis = visibleCount + 1 < tags.length;
    const reserveWidth = hasHiddenAfterThis ? gap + morePillWidth : 0;
    if (nextWidth + reserveWidth > width) {
      break;
    }
    usedWidth = nextWidth;
    visibleCount += 1;
  }

  return Math.max(visibleCount, Math.min(tags.length, 1));
}

function estimateTagPillWidth(label) {
  return Math.min(150, Math.max(42, String(label || "").length * 7 + 24));
}

function normalizeHexColor(color) {
  const value = String(color || "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "";
}

function readableTextColor(hex) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#17212b" : "#ffffff";
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function todayInputValue() {
  return formatDateInput(new Date());
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function subtractRelativeDate(date, amount, unit) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === "weeks") {
    next.setDate(next.getDate() - amount * 7);
  } else if (unit === "months") {
    next.setMonth(next.getMonth() - amount);
  } else {
    next.setDate(next.getDate() - amount);
  }
  return next;
}
