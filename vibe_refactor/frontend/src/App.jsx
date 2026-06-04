import { useCallback, useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (filterDefaults.to || filterDefaults.from) {
      loadDashboard();
    }
  }, [filterDefaults, filterParams, loadDashboard]);

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

      <div className="chart-grid">
        <ChartPanel title="Monthly Flow"><MonthlyChart rows={summary?.monthly || []} /></ChartPanel>
        <ChartPanel title="Income Categories"><SunburstChart rows={summary?.income_categories || []} label="Income" /></ChartPanel>
        <ChartPanel title="Expense Categories"><SunburstChart rows={summary?.expense_categories || []} label="Expenses" /></ChartPanel>
        <ChartPanel title="Want / Need / Investment"><WniChart rows={summary?.want_need_investment || []} /></ChartPanel>
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
  const subcategoryLookup = useMemo(() => new Map(refs.subcategories.map((item) => [item.id, subLabel(item)])), [refs.subcategories]);
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
      type: "rightAligned",
      valueFormatter: (params) => money(params.value),
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
      valueFormatter: (params) => params.value?.name || "Unassigned",
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 150,
    },
    {
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: subcategoryOptions },
      editable: true,
      field: "subcategory_id",
      headerName: "Subcategory",
      valueFormatter: (params) => subcategoryLookup.get(params.value) || "Unassigned",
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 230,
    },
    {
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["", "want", "need", "investment"] },
      editable: true,
      field: "want_need_investment",
      headerName: "WNI",
      valueFormatter: (params) => (params.value ? titleCase(params.value) : "Unassigned"),
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 135,
    },
    {
      field: "tags",
      headerName: "Tags",
      cellRenderer: (params) => <TagCloud tags={params.value || []} />,
      sortable: false,
      minWidth: 180,
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
  ], [accountLookup, notify, subcategoryLookup, subcategoryOptions, updateTransaction]);

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

function ChartPanel({ children, title }) {
  return <section className="panel chart-panel"><div className="panel-header"><h2>{title}</h2></div>{children}</section>;
}

function MonthlyChart({ rows }) {
  if (!rows.length) return <EmptyChart />;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[
        { marker: { color: "#2f8f65" }, name: "Income", type: "bar", x: rows.map((row) => row.month), y: rows.map((row) => row.income) },
        { marker: { color: "#c96e26" }, name: "Expenses", type: "bar", x: rows.map((row) => row.month), y: rows.map((row) => row.expense) },
      ]}
      layout={baseLayout({ barmode: "group", yaxis: { tickprefix: "CZK " } })}
      useResizeHandler
    />
  );
}

function SunburstChart({ label, rows }) {
  if (!rows.length) return <EmptyChart />;
  const { ids, labels, parents, values } = sunburstData(rows);
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{ branchvalues: "total", ids, labels, parents, type: "sunburst", values }]}
      layout={baseLayout({ margin: { t: 8, r: 8, b: 8, l: 8 }, title: undefined })}
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
        marker: { colors: ["#7655a6", "#2f8f65", "#b1842f", "#5f6f7a"] },
        type: "pie",
        values: cleanRows.map((row) => row.amount),
      }]}
      layout={baseLayout({ margin: { t: 8, r: 8, b: 8, l: 8 }, showlegend: true })}
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
  return (
    <label>
      <span>{label}</span>
      <select multiple onChange={(event) => onChange(name, Array.from(event.target.selectedOptions).map((option) => option.value))} size="4" value={value}>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </label>
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

function TagCloud({ tags }) {
  return <div className="tag-cloud">{tags.map((tag) => <span className="pill" key={tag.id} style={tag.color ? { borderColor: tag.color } : undefined}>{tag.name}</span>)}</div>;
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
  return {
    autosize: true,
    font: { color: "#17212b", family: "Inter, Segoe UI, sans-serif" },
    height: 285,
    margin: { t: 24, r: 20, b: 42, l: 54 },
    paper_bgcolor: "rgba(255,255,255,0)",
    plot_bgcolor: "rgba(255,255,255,0)",
    ...extra,
  };
}

function sunburstData(rows) {
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
    (category.children || []).forEach((child) => {
      ids.push(`${categoryId}:${child.name}`);
      labels.push(child.name);
      parents.push(categoryId);
      values.push(child.amount);
    });
  });
  return { ids, labels, parents, values };
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
  return new Intl.NumberFormat("en-US", { currency: "CZK", maximumFractionDigits: 0, style: "currency" }).format(Number(value || 0));
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
