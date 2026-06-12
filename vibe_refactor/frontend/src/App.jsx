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
  help: ["Help", "Usage guide for importing, categorizing, reviewing, and maintaining your finance data."],
};
export const THEME_STORAGE_KEY = "cashmoney-theme";
export const ACCENT_STORAGE_KEY = "cashmoney-accent";
export const HIDE_AMOUNTS_STORAGE_KEY = "cashmoney-hide-amounts";
const HIDDEN_AMOUNT = "----";
const accentPresets = [
  ["Blue", "#58a6ff"],
  ["Indigo", "#6366f1"],
  ["Violet", "#a371f7"],
  ["Fuchsia", "#d946ef"],
  ["Pink", "#ec4899"],
  ["Rose", "#f43f5e"],
  ["Red", "#ef4444"],
  ["Orange", "#f97316"],
  ["Amber", "#f59e0b"],
  ["Yellow", "#eab308"],
  ["Lime", "#84cc16"],
  ["Green", "#22c55e"],
  ["Emerald", "#10b981"],
  ["Teal", "#14b8a6"],
  ["Cyan", "#06b6d4"],
  ["Slate", "#64748b"],
];
const wniOptions = [
  ["want", "Want"],
  ["need", "Need"],
  ["investment", "Investment"],
];
const definitionHelp = {
  "Bank Accounts": "Bank accounts group imported transactions by account, bank, currency, owner count, and optional default CSV mapping.",
  "CSV Mappings": "CSV mappings describe how a bank statement file should be parsed, including separators, date formats, columns, and categorization text fields.",
  Categories: "Categories are the top-level buckets used for dashboard breakdowns and reporting.",
  Subcategories: "Subcategories sit under categories and are the actual category-like value assigned to transactions.",
  Tags: "Tags are optional labels that can be attached to multiple transactions for flexible filtering.",
  Keywords: "Keywords automatically categorize transactions by matching text and assigning subcategory, WNI, tags, or ignored status.",
};
const mappingFields = [
  ["original_id", "Original ID"],
  ["transaction_date", "Transaction Date"],
  ["posted_date", "Posted Date"],
  ["description", "Description"],
  ["amount", "Amount"],
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
const defaultParsingSettings = {
  delimiter: ",",
  quotechar: '"',
  encoding: "utf-8-sig",
  header_row: 0,
  date_format: "%Y-%m-%d",
  decimal_separator: ".",
  thousands_separator: "",
};

export function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

export function getStoredTheme() {
  if (typeof window === "undefined") {
    return "dark";
  }
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }
  const normalizedTheme = normalizeTheme(theme);
  if (normalizedTheme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
}

export function getStoredAccent() {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeHexColor(window.localStorage.getItem(ACCENT_STORAGE_KEY));
}

export function getStoredHideAmounts() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(HIDE_AMOUNTS_STORAGE_KEY) === "true";
}

export function defaultAccentForTheme(theme) {
  return normalizeTheme(theme) === "light" ? "#2f6f9f" : "#58a6ff";
}

export function applyAccent(color) {
  if (typeof document === "undefined") {
    return;
  }
  const normalizedColor = normalizeHexColor(color);
  const rootStyle = document.documentElement.style;
  if (!normalizedColor) {
    rootStyle.removeProperty("--action");
    rootStyle.removeProperty("--accent-text");
    rootStyle.removeProperty("--on-accent");
    rootStyle.removeProperty("--focus-ring");
    window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    return;
  }
  const textColor = readableTextColor(normalizedColor);
  rootStyle.setProperty("--action", normalizedColor);
  rootStyle.setProperty("--accent-text", textColor);
  rootStyle.setProperty("--on-accent", textColor);
  rootStyle.setProperty("--focus-ring", hexToRgba(normalizedColor, 0.24));
  window.localStorage.setItem(ACCENT_STORAGE_KEY, normalizedColor);
}

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
    split_by_owners: false,
  };
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [theme, setTheme] = useState(getStoredTheme);
  const [accent, setAccent] = useState(getStoredAccent);
  const [hideAmounts, setHideAmounts] = useState(getStoredHideAmounts);
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false);
  const [status, setStatus] = useState("Checking backend");
  const [toast, setToast] = useState("");
  const [refs, setRefs] = useState({
    accounts: [],
    mappings: [],
    categories: [],
    subcategories: [],
    tags: [],
    keywords: [],
    settings: null,
  });
  const [filters, setFilters] = useState(emptyFilters);
  const [filterDefaults, setFilterDefaults] = useState({ from: "", to: "" });
  const [summary, setSummary] = useState(null);
  const [transactionPage, setTransactionPage] = useState({ count: 0, total_count: 0, results: [] });
  const [recategorizeResult, setRecategorizeResult] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [refreshingApp, setRefreshingApp] = useState(false);
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
    const [accounts, mappings, categories, subcategories, tags, keywords, settings] = await Promise.all([
      apiGet("/bank-accounts/"),
      apiGet("/csv-mappings/"),
      apiGet("/categories/"),
      apiGet("/subcategories/"),
      apiGet("/tags/"),
      apiGet("/keywords/"),
      apiGet("/settings/"),
    ]);
    setRefs({ accounts, mappings, categories, subcategories, tags, keywords, settings });
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
    setRefreshingApp(true);
    try {
      await apiGet("/health/");
      setStatus("Backend online");
      await Promise.all([loadReferenceData(), loadFilterDefaults()]);
    } catch (error) {
      setStatus("Backend offline");
      notify(error.message);
    } finally {
      setRefreshingApp(false);
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
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    if (!isAccentPickerOpen) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsAccentPickerOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isAccentPickerOpen]);

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

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      return nextTheme;
    });
  };

  const toggleHideAmounts = () => {
    setHideAmounts((current) => {
      const next = !current;
      window.localStorage.setItem(HIDE_AMOUNTS_STORAGE_KEY, String(next));
      return next;
    });
  };

  const updateAccent = (color) => {
    setAccent(color);
    applyAccent(color);
    setIsAccentPickerOpen(false);
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
        <SidebarAsciiPlay />
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
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{kicker}</p>
          </div>
          <div className="topbar-actions">
            <button className="link-button accent-picker-trigger" onClick={() => setIsAccentPickerOpen(true)} title="Choose accent color" type="button">
              <span className="accent-swatch" style={{ background: accent || defaultAccentForTheme(theme) }} />
              <span>Accent</span>
            </button>
            <button
              aria-pressed={theme === "light"}
              className="link-button theme-toggle"
              onClick={toggleTheme}
              type="button"
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button
              aria-pressed={hideAmounts}
              className={`link-button privacy-toggle ${hideAmounts ? "is-active" : ""}`}
              onClick={toggleHideAmounts}
              title="Hide amount values"
              type="button"
            >
              {hideAmounts ? "Show amounts" : "Hide amounts"}
            </button>
            <a className="link-button" href="/admin/" rel="noreferrer" target="_blank">Admin</a>
            <LoadingButton busy={refreshingApp} busyLabel="Refreshing" className="primary-action" onClick={loadAll} type="button">Refresh</LoadingButton>
          </div>
        </header>

        {activePage === "dashboard" && (
          <DashboardPage
            filters={filters}
            hideAmounts={hideAmounts}
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
        {activePage === "help" && <HelpPage />}
      </main>
      {isAccentPickerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setIsAccentPickerOpen(false)} role="presentation">
          <div aria-labelledby="accent-modal-title" aria-modal="true" className="accent-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div className="accent-modal-header">
              <h2 id="accent-modal-title">Accent</h2>
              <button className="icon-button" onClick={() => setIsAccentPickerOpen(false)} type="button" aria-label="Close accent picker">x</button>
            </div>
            <div className="accent-preset-grid">
              {accentPresets.map(([name, color]) => {
                const isSelected = normalizeHexColor(accent || defaultAccentForTheme(theme)).toLowerCase() === color.toLowerCase();
                return (
                  <button
                    className={`accent-preset ${isSelected ? "is-selected" : ""}`}
                    key={color}
                    onClick={() => updateAccent(color)}
                    style={{ "--preset-color": color }}
                    type="button"
                  >
                    <span className="accent-preset-swatch" />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className={`toast ${toast ? "is-visible" : ""}`}>{toast}</div>
    </div>
  );
}

function SidebarAsciiPlay() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    let animationFrame = 0;
    let lastDraw = 0;
    let columns = 34;
    let rows = 64;
    let characterHeight = 10.6;

    function updateSize() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      const styles = window.getComputedStyle(canvas);
      const font = styles.font || `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
      context.font = font;
      const characterWidth = context.measureText("M").width || 5.1;
      const parsedLineHeight = Number.parseFloat(styles.lineHeight);
      const parsedFontSize = Number.parseFloat(styles.fontSize);
      characterHeight = parsedLineHeight || parsedFontSize * 1.2 || 10.6;
      columns = Math.max(24, Math.ceil(width / characterWidth));
      rows = Math.max(24, Math.ceil(height / characterHeight));
      canvas.width = Math.ceil(width * pixelRatio);
      canvas.height = Math.ceil(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.font = font;
      context.textBaseline = "top";
    }

    function renderFrame(timestamp) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.fillStyle = window.getComputedStyle(canvas).color;
      context.clearRect(0, 0, width, height);
      const content = buildSidebarAsciiFrame(timestamp / 120, { columns, rows });
      content.split("\n").forEach((line, index) => {
        context.fillText(line, 0, index * characterHeight);
      });
    }

    function draw(timestamp) {
      animationFrame = window.requestAnimationFrame(draw);
      if (timestamp - lastDraw < 33) {
        return;
      }
      lastDraw = timestamp;
      renderFrame(timestamp);
    }

    updateSize();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      renderFrame(0);
      const observer = new MutationObserver(() => renderFrame(0));
      observer.observe(document.documentElement, {
        attributeFilter: ["class", "data-theme", "style"],
        attributes: true,
      });
      return () => observer.disconnect();
    }
    animationFrame = window.requestAnimationFrame(draw);
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", updateSize);
      };
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, []);

  return <canvas aria-hidden="true" className="sidebar-ascii-play" ref={canvasRef} />;
}

function DashboardPage({
  filters,
  filterParams,
  hideAmounts,
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
  const metrics = useMemo(
    () => buildMetrics(summary, transactionPage, hideAmounts),
    [hideAmounts, summary, transactionPage],
  );
  const [recategorizing, setRecategorizing] = useState(false);

  async function recategorize() {
    if (!transactionPage.count) {
      notify("No filtered transactions");
      return;
    }
    if (!window.confirm(`Recategorize ${transactionPage.count.toLocaleString()} filtered transactions?`)) {
      return;
    }
    setRecategorizing(true);
    try {
      const result = await apiPost("/transactions/recategorize/", {}, filterParams);
      setRecategorizeResult(result);
      notify(`${Number(result.updated || 0).toLocaleString()} transactions updated`);
      await reloadDashboard();
    } catch (error) {
      notify(error.message);
    } finally {
      setRecategorizing(false);
    }
  }

  return (
    <>
      <section className="filter-panel">
        <div className="filter-quick-grid">
          <DateInput label="From" name="date_from" onChange={onFilterChange} value={filters.date_from} />
          <DateInput label="To" name="date_to" onChange={onFilterChange} value={filters.date_to} />
          <label className="wide-field">
            <span>Search</span>
            <input onChange={(event) => onFilterChange("q", event.target.value)} placeholder="Description" type="search" value={filters.q} />
          </label>
          <label className="check-row">
            <input checked={filters.include_ignored} onChange={(event) => onFilterChange("include_ignored", event.target.checked)} type="checkbox" />
            <span>Ignored</span>
          </label>
          <label className="check-row">
            <input checked={filters.split_by_owners} onChange={(event) => onFilterChange("split_by_owners", event.target.checked)} type="checkbox" />
            <span>Split by owners</span>
          </label>
        </div>
        <div className="filter-checkbox-grid">
          <CheckboxFilterPanel className="filter-account" label="Account" name="bank_account" onChange={onFilterChange} options={refs.accounts.map((item) => [item.id, item.name])} value={filters.bank_account} />
          <CheckboxFilterPanel
            className="filter-category"
            label="Category"
            name="category"
            onChange={onFilterChange}
            options={[[UNASSIGNED, "Unassigned category"], ...refs.categories.map((item) => [item.id, item.name])]}
            value={filters.category}
          />
          <CheckboxFilterPanel
            className="filter-subcategory"
            label="Subcategory"
            name="subcategory"
            onChange={onFilterChange}
            options={[[UNASSIGNED, "Unassigned subcategory"], ...refs.subcategories.map((item) => [item.id, subLabel(item)])]}
            value={filters.subcategory}
          />
          <CheckboxFilterPanel
            className="filter-wni"
            label="WNI"
            name="want_need_investment"
            onChange={onFilterChange}
            options={[...wniOptions, [UNASSIGNED, "Unassigned"]]}
            value={filters.want_need_investment}
          />
          <CheckboxFilterPanel
            className="filter-tag"
            label="Tag"
            name="tag"
            onChange={onFilterChange}
            options={[[UNASSIGNED, "No tags"], ...refs.tags.map((item) => [item.id, item.name])]}
            value={filters.tag}
          />
        </div>
      </section>

      <div className="metrics-grid">
        {metrics.map(([label, value, tone, secondary]) => (
          <div className="metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className={`metric-value ${tone}`}>{value}</div>
            {secondary && (
              <div className="metric-secondary">
                <span>Avg / month:</span>
                <strong className={secondary.tone}>{secondary.value}</strong>
              </div>
            )}
          </div>
        ))}
        <div className="metric dashboard-action-card">
          <div className="metric-label">Actions</div>
          <div className="dashboard-action-section">
            <RelativeRangeForm setFilters={setFilters} />
          </div>
          <div className="dashboard-action-section">
            <LoadingButton
              busy={recategorizing}
              busyLabel="Recategorizing"
              className="primary-action"
              disabled={!transactionPage.count || importBusy}
              onClick={recategorize}
              type="button"
            >
              Recategorize Filtered
            </LoadingButton>
          </div>
        </div>
      </div>
      {recategorizeResult && <RecategorizeStats result={recategorizeResult} />}

      <div className="dashboard-charts">
        <ChartPanel className="chart-panel-wide" title="Monthly Flow"><MonthlyChart hideAmounts={hideAmounts} rows={summary?.monthly || []} /></ChartPanel>
        <ChartPanel title="Income Categories"><SunburstChart hideAmounts={hideAmounts} rows={summary?.income_categories || []} /></ChartPanel>
        <ChartPanel title="Expense Categories"><SunburstChart hideAmounts={hideAmounts} rows={summary?.expense_categories || []} /></ChartPanel>
        <ChartPanel title="Want / Need / Investment"><WniChart hideAmounts={hideAmounts} rows={summary?.want_need_investment || []} /></ChartPanel>
        <ChartPanel title="Top Expense Subcategories"><TopExpenseChart hideAmounts={hideAmounts} rows={summary?.expense_categories || []} /></ChartPanel>
      </div>

      <section className="panel transaction-panel">
        <div className="panel-header">
          <h2>Transactions</h2>
          <span className="muted">{transactionPage.count.toLocaleString()} shown</span>
        </div>
        <TransactionGrid hideAmounts={hideAmounts} notify={notify} refs={refs} rows={transactionPage.results} updateTransaction={updateTransaction} />
      </section>
    </>
  );
}

function TransactionGrid({ hideAmounts, notify, refs, rows, updateTransaction }) {
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
      valueFormatter: (params) => formatAmountValue(params.value, hideAmounts),
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
  ], [accountLookup, categoryLookup, hideAmounts, notify, refs.tags, subcategoryLookup, subcategoryOptions, updateTransaction]);

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

function MaintenancePage({ notify, reloadAll, reloadDashboard, reloadMaintenance, summary }) {
  const [deleting, setDeleting] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [safeBusy, setSafeBusy] = useState("");
  const [refreshingCounts, setRefreshingCounts] = useState(false);
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

function HelpPage() {
  return (
    <div className="help-page">
      <section className="panel help-hero">
        <div>
          <h2>Cashmoney Help Guide</h2>
          <p>
            Cashmoney is a local desktop finance app for importing bank statement CSV files,
            automatically categorizing transactions, reviewing spending patterns, and maintaining
            your own finance definitions. The normal workflow is: define accounts and mappings,
            import CSV files, review the dashboard, adjust rules, then recategorize filtered
            transactions when your rules improve.
          </p>
        </div>
        <HelpScreenshot
          label="Screenshot placeholder"
          note="Add a full Dashboard screenshot here after the final layout is stable."
        />
      </section>

      <section className="help-grid">
        <article className="panel help-card">
          <h2>1. Set Up Definitions First</h2>
          <p>
            The Definitions page is where you create the objects the rest of the app depends on.
            You can add bank accounts, CSV mappings, categories, subcategories, tags, and keyword
            rules. The dashboard and import flow become much more useful once these are defined.
          </p>
          <ul>
            <li><strong>Bank Accounts:</strong> create one entry per account you import from. Use owner count for shared accounts.</li>
            <li><strong>CSV Mappings:</strong> describe how each bank statement format maps columns into transactions.</li>
            <li><strong>Categories:</strong> create broad reporting groups such as Food, Housing, Transport, or Income.</li>
            <li><strong>Subcategories:</strong> create the assignable child values, such as Groceries, Coffee, Rent, or Salary.</li>
            <li><strong>Tags:</strong> add flexible labels for cross-cutting topics like Vacation, Work, Cash, or Family.</li>
            <li><strong>Keywords:</strong> define text matching rules that categorize imported or existing transactions.</li>
          </ul>
          <HelpScreenshot
            label="Definitions screenshot"
            note="Capture the Definitions page showing several populated sections and the color picker."
          />
        </article>

        <article className="panel help-card">
          <h2>2. Create A CSV Mapping</h2>
          <p>
            A CSV mapping tells Cashmoney how to read a specific bank export. If different banks
            use different column names, separators, date formats, or decimal separators, create a
            separate mapping for each format.
          </p>
          <ol>
            <li>Open Definitions and find CSV Mappings.</li>
            <li>Fill in the mapping name and default currency.</li>
            <li>Choose a sample CSV file from that bank export.</li>
            <li>Use column detection to fill parsing settings and populate dropdown options from the actual CSV headers.</li>
            <li>Select which CSV columns map to transaction fields like date, description, amount, currency, and notes.</li>
            <li>Select categorization fields. These are the text fields Keywords will inspect.</li>
          </ol>
          <p>
            Advanced parsing settings remain editable if detection guesses a separator, header row, encoding, or date format incorrectly.
          </p>
        </article>

        <article className="panel help-card">
          <h2>3. Import A Bank Statement</h2>
          <p>
            The Import page loads a CSV statement into the local SQLite database. Each parsed row
            becomes a Transaction. During import, Cashmoney applies your current Keyword rules to
            assign subcategory, Want/Need/Investment, tags, or ignored status.
          </p>
          <ol>
            <li>Open Import.</li>
            <li>Choose the CSV file.</li>
            <li>Select the bank account.</li>
            <li>Cashmoney uses the selected bank account's default CSV mapping.</li>
            <li>Submit the import and review the report for created rows, duplicates, and errors.</li>
          </ol>
          <p>
            Duplicate detection helps prevent accidentally importing the same statement twice.
            Malformed or missing required CSV fields are reported so you can fix the mapping or
            the source file.
          </p>
          <HelpScreenshot
            label="Import screenshot"
            note="Capture the Import page with a selected CSV and an import result report."
          />
        </article>

        <article className="panel help-card">
          <h2>4. Understand Automatic Categorization</h2>
          <p>
            Keywords are matching rules. When transaction text contains the configured include
            terms and does not contain excluded terms, the rule can assign a subcategory, WNI value,
            tags, and ignored status. Higher priority rules win when more than one rule matches.
          </p>
          <ul>
            <li><strong>Subcategory:</strong> controls the derived Category shown in the table and charts.</li>
            <li><strong>WNI:</strong> classifies expenses as Want, Need, or Investment.</li>
            <li><strong>Tags:</strong> add one or more reusable labels to matching transactions.</li>
            <li><strong>Ignored:</strong> removes transactions such as own-account transfers from normal dashboard analysis.</li>
            <li><strong>Priority:</strong> helps resolve multiple matching rules.</li>
          </ul>
          <p>
            Good keyword rules are usually short and specific. For example, a rule matching a
            known merchant name should usually be more reliable than a broad word like payment.
          </p>
        </article>

        <article className="panel help-card help-card-wide">
          <h2>5. Review The Dashboard</h2>
          <p>
            The Dashboard is the main workspace. It combines filters, charts, a recategorization
            action, summary metrics, and an editable transaction table.
          </p>
          <div className="help-two-column">
            <div>
              <h3>Charts</h3>
              <ul>
                <li><strong>Monthly Flow:</strong> income is positive, expenses are negative, and net overlays the bars.</li>
                <li><strong>Income Categories:</strong> category and subcategory sunburst for income transactions.</li>
                <li><strong>Expense Categories:</strong> category and subcategory sunburst for expense transactions.</li>
                <li><strong>WNI:</strong> Want, Need, Investment, and Uncategorized distribution.</li>
                <li><strong>Top Expense Subcategories:</strong> the largest expense subcategories in the current filter scope.</li>
              </ul>
            </div>
            <div>
              <h3>Filters</h3>
              <ul>
                <li>Date range filters default from the oldest transaction to today.</li>
                <li>The Actions card can quickly show the last X days, weeks, or months.</li>
                <li>Account, Category, Subcategory, WNI, and Tag filters support multiple selections.</li>
                <li>Unassigned filter options help find uncategorized or untagged transactions.</li>
                <li>Search looks across relevant transaction text fields.</li>
              </ul>
            </div>
          </div>
          <HelpScreenshot
            label="Dashboard screenshot"
            note="Capture the Dashboard with filters open, charts visible, and a few rows in the transaction table."
          />
        </article>

        <article className="panel help-card">
          <h2>6. Edit Transactions In The Table</h2>
          <p>
            The Transactions table is meant for review and correction. Amounts are colored by
            direction. Category, Subcategory, and WNI cells use their assigned colors as cell
            backgrounds. Tags remain visible as colored labels.
          </p>
          <ul>
            <li><strong>Subcategory:</strong> edit with the dropdown to manually change the classification.</li>
            <li><strong>WNI:</strong> edit with the dropdown to choose Want, Need, Investment, or blank.</li>
            <li><strong>Tags:</strong> click the Tags cell to open the multi-tag editor, then Apply.</li>
            <li><strong>Ignored:</strong> use the checkbox to include or exclude a transaction from normal analysis.</li>
          </ul>
          <p>
            Saved table edits are written to the backend immediately. After a successful edit,
            the charts refresh so the dashboard stays in sync.
          </p>
        </article>

        <article className="panel help-card">
          <h2>7. Recategorize After Rule Changes</h2>
          <p>
            Recategorization is useful after you import transactions, notice many uncategorized
            rows, and then improve your Keyword rules. It only affects the transactions currently
            selected by the Dashboard filters.
          </p>
          <ol>
            <li>Filter the Dashboard to the transactions you want to update.</li>
            <li>Open Definitions and add or adjust Keywords.</li>
            <li>Return to Dashboard.</li>
            <li>Use Recategorize Filtered.</li>
            <li>Review the result counts and table changes.</li>
          </ol>
          <p>
            This makes it possible to recategorize one account, one month, one tag, or only
            uncategorized transactions instead of rewriting everything.
          </p>
        </article>

        <article className="panel help-card">
          <h2>8. Use Maintenance Carefully</h2>
          <p>
            Maintenance is for backups, restores, sample data, and destructive cleanup. It is
            useful during development and for local database management.
          </p>
          <ul>
            <li><strong>Database Snapshot:</strong> shows counts for transactions, imports, definitions, and sample data.</li>
            <li><strong>Export Backup:</strong> downloads a SQLite backup of the current database.</li>
            <li><strong>Restore Backup:</strong> replaces the current database from a backup file.</li>
            <li><strong>Recreate Samples:</strong> removes and recreates demo sample data.</li>
            <li><strong>Danger Zone:</strong> deletes sample data, all transactions, or all finance data.</li>
          </ul>
          <p>
            Export a backup before using Danger Zone actions. These actions affect the local
            database and are not meant as routine dashboard tools.
          </p>
          <HelpScreenshot
            label="Maintenance screenshot"
            note="Capture the Maintenance page showing Database Snapshot, Safe Tools, and Danger Zone."
          />
        </article>

        <article className="panel help-card">
          <h2>9. Troubleshooting</h2>
          <ul>
            <li><strong>CSV import has errors:</strong> check delimiter, header row, date format, decimal separator, and required column mapping.</li>
            <li><strong>Transactions are uncategorized:</strong> add Keywords, then recategorize the filtered transactions.</li>
            <li><strong>Charts look empty:</strong> check filters, include ignored setting, and date range.</li>
            <li><strong>Own-account transfers distort totals:</strong> add transfer Keywords that mark those transactions as ignored.</li>
            <li><strong>Wrong category appears:</strong> edit the transaction manually or adjust Keyword priority and recategorize.</li>
            <li><strong>Need to start over:</strong> export a backup first, then use Maintenance cleanup actions.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}

function HelpScreenshot({ label, note }) {
  return (
    <div className="help-screenshot">
      <div className="help-screenshot-label">{label}</div>
      <p>{note}</p>
    </div>
  );
}

function DefinitionsPage({ mappingDraft, notify, refs, reloadAll, setMappingDraft }) {
  const [editingItems, setEditingItems] = useState({});

  function editItem(endpoint, item) {
    setEditingItems((current) => ({ ...current, [endpoint]: item }));
  }

  function clearEditing(endpoint) {
    setEditingItems((current) => {
      const next = { ...current };
      delete next[endpoint];
      return next;
    });
  }

  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>App Settings</h2>
        </div>
        <SettingsForm notify={notify} refs={refs} reloadAll={reloadAll} settings={refs.settings} />
      </section>
      <DefinitionPanel endpoint="/csv-mappings/" formatter={(item) => [item.name, `${item.delimiter} - ${item.date_format}`]} helpText={definitionHelp["CSV Mappings"]} items={refs.mappings} notify={notify} onDeleted={() => clearEditing("/csv-mappings/")} onEdit={(item) => editItem("/csv-mappings/", item)} reloadAll={reloadAll} title="CSV Mappings">
        <MappingForm clearEditing={() => clearEditing("/csv-mappings/")} draft={mappingDraft} editingItem={editingItems["/csv-mappings/"]} notify={notify} refs={refs} reloadAll={reloadAll} setDraft={setMappingDraft} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/bank-accounts/" formatter={(item) => [item.name, `${item.bank_name || "Bank"} - ${item.account_number}`]} helpText={definitionHelp["Bank Accounts"]} items={refs.accounts} notify={notify} onDeleted={() => clearEditing("/bank-accounts/")} onEdit={(item) => editItem("/bank-accounts/", item)} reloadAll={reloadAll} title="Bank Accounts">
        <AccountForm clearEditing={() => clearEditing("/bank-accounts/")} editingItem={editingItems["/bank-accounts/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/categories/" formatter={(item) => [item.name, item.description || ""]} helpText={definitionHelp.Categories} items={refs.categories} notify={notify} onDeleted={() => clearEditing("/categories/")} onEdit={(item) => editItem("/categories/", item)} reloadAll={reloadAll} title="Categories">
        <SimpleForm clearEditing={() => clearEditing("/categories/")} editingItem={editingItems["/categories/"]} endpoint="/categories/" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.categories} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/subcategories/" formatter={(item) => [item.name, item.category?.name || ""]} helpText={definitionHelp.Subcategories} items={refs.subcategories} notify={notify} onDeleted={() => clearEditing("/subcategories/")} onEdit={(item) => editItem("/subcategories/", item)} reloadAll={reloadAll} title="Subcategories">
        <SubcategoryForm clearEditing={() => clearEditing("/subcategories/")} editingItem={editingItems["/subcategories/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/tags/" formatter={(item) => [item.name, item.description || ""]} helpText={definitionHelp.Tags} items={refs.tags} notify={notify} onDeleted={() => clearEditing("/tags/")} onEdit={(item) => editItem("/tags/", item)} reloadAll={reloadAll} title="Tags">
        <SimpleForm clearEditing={() => clearEditing("/tags/")} editingItem={editingItems["/tags/"]} endpoint="/tags/" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.tags} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/keywords/" formatter={(item) => [item.name, `${(item.include_terms || []).join(", ")} - ${item.subcategory?.name || "No subcategory"} - ${item.want_need_investment || "No WNI"}`]} helpText={definitionHelp.Keywords} items={refs.keywords} notify={notify} onDeleted={() => clearEditing("/keywords/")} onEdit={(item) => editItem("/keywords/", item)} reloadAll={reloadAll} title="Keywords" wide>
        <KeywordForm clearEditing={() => clearEditing("/keywords/")} editingItem={editingItems["/keywords/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
    </div>
  );
}

function SettingsForm({ notify, refs, reloadAll, settings }) {
  const [saving, setSaving] = useState(false);
  const [ignoreInternalAccounts, setIgnoreInternalAccounts] = useState(
    settings?.ignore_internal_account_references ?? true,
  );
  const [internalTransferSubcategoryId, setInternalTransferSubcategoryId] = useState(
    settings?.internal_transfer_subcategory?.id || "",
  );

  useEffect(() => {
    setIgnoreInternalAccounts(settings?.ignore_internal_account_references ?? true);
    setInternalTransferSubcategoryId(settings?.internal_transfer_subcategory?.id || "");
  }, [settings]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiPatch("/settings/", {
        ignore_internal_account_references: ignoreInternalAccounts,
        internal_transfer_subcategory_id: internalTransferSubcategoryId,
      });
      notify("Settings saved");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compact-form" onSubmit={submit}>
      <label className="check-row">
        <input
          checked={ignoreInternalAccounts}
          onChange={(event) => setIgnoreInternalAccounts(event.target.checked)}
          type="checkbox"
        />
        <span>Ignore transactions that mention another configured bank account</span>
      </label>
      <FormField label="Internal Transfer Subcategory">
        <Select
          blank="No automatic subcategory"
          name="internal_transfer_subcategory_id"
          onChange={(event) => setInternalTransferSubcategoryId(event.target.value)}
          options={refs.subcategories.map((item) => [item.id, subLabel(item)])}
          value={internalTransferSubcategoryId}
        />
      </FormField>
      <LoadingButton busy={saving} busyLabel="Saving" type="submit">Save</LoadingButton>
    </form>
  );
}

function DefinitionPanel({ children, endpoint, formatter, helpText, items, notify, onDeleted, onEdit, reloadAll, title, wide = false }) {
  return (
    <section className={`panel ${wide ? "wide-panel" : ""}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        {helpText && <HelpTooltip text={helpText} />}
      </div>
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
                <button className="edit-button" onClick={() => onEdit(item)} type="button">Edit</button>
                <DeleteButton endpoint={`${endpoint}${item.id}/`} name={itemTitle} notify={notify} onDeleted={onDeleted} reloadAll={reloadAll} />
              </div>
            </div>
          );
        }) : <div className="muted">No records yet.</div>}
      </div>
    </section>
  );
}

function HelpTooltip({ text }) {
  return (
    <span className="help-tooltip">
      <button aria-label={text} className="help-tooltip-button" type="button">?</button>
      <span className="help-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

function DeleteButton({ endpoint, name, notify, onDeleted, reloadAll }) {
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete ${name}?`)) {
      return;
    }
    setDeleting(true);
    try {
      await apiDelete(endpoint);
      onDeleted?.();
      notify?.(`${name} deleted`);
      await reloadAll?.();
    } catch (error) {
      notify?.(error.message);
    } finally {
      setDeleting(false);
    }
  }
  return <LoadingButton busy={deleting} busyLabel="Deleting" className="delete-button" onClick={remove} type="button">Delete</LoadingButton>;
}

function FormField({ children, className = "", label }) {
  return (
    <label className={`form-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function FormActions({ busy = false, clearEditing, isEditing }) {
  return (
    <div className="form-actions">
      <LoadingButton busy={busy} busyLabel={isEditing ? "Saving" : "Adding"} type="submit">{isEditing ? "Save" : "Add"}</LoadingButton>
      {isEditing && <button className="link-button" disabled={busy} onClick={clearEditing} type="button">Cancel</button>}
    </div>
  );
}

function AccountForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    if (!validateRequiredFields(form, ["name", "account_number", "currency", "owners"], notify)) {
      return;
    }
    const accountConflict = findDuplicate(
      refs.accounts,
      "account_number",
      data.account_number,
      editingItem?.id,
    );
    if (accountConflict) {
      notify("Account number already exists");
      form.elements.account_number?.focus();
      return;
    }
    data.owners = Number(data.owners || 1);
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/bank-accounts/${editingItem.id}/`, data);
      } else {
        await apiPost("/bank-accounts/", data);
      }
      form.reset();
      clearEditing?.();
      notify(isEditing ? "Account saved" : "Account added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="compact-form" key={editingItem?.id || "new-account"} onSubmit={submit}>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Account name" required /></FormField>
      <FormField label="Account Number"><input defaultValue={editingItem?.account_number || ""} name="account_number" placeholder="Account number" required /></FormField>
      <FormField label="Bank"><input defaultValue={editingItem?.bank_name || ""} name="bank_name" placeholder="Bank name" /></FormField>
      <FormField label="Currency"><input defaultValue={editingItem?.currency || "CZK"} maxLength="3" name="currency" placeholder="CZK" required /></FormField>
      <FormField label="Owners"><input defaultValue={editingItem?.owners || "1"} min="1" name="owners" required type="number" /></FormField>
      <FormField label="Default CSV Mapping"><Select blank="No default mapping" defaultValue={editingItem?.default_csv_mapping?.id || ""} name="default_csv_mapping_id" options={refs.mappings.map((item) => [item.id, item.name])} /></FormField>
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
  );
}

function MappingForm({ clearEditing, draft, editingItem, notify, refs, reloadAll, setDraft }) {
  const headers = useMemo(
    () => mappedColumnOptions(draft.detected?.headers || [], draft.column_map),
    [draft.detected?.headers, draft.column_map],
  );
  const isEditing = Boolean(editingItem);
  const [parsingSettings, setParsingSettings] = useState(() => parsingSettingsFromMapping(editingItem));
  const [manualParsingSettings, setManualParsingSettings] = useState(Boolean(editingItem));
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingItem) {
      setParsingSettings(defaultParsingSettings);
      setManualParsingSettings(false);
      return;
    }
    setParsingSettings(parsingSettingsFromMapping(editingItem));
    setManualParsingSettings(true);
    setDraft({
      column_map: sanitizeColumnMap(editingItem.column_map || {}),
      categorization_fields: editingItem.categorization_fields || defaultCategorizationFields,
      detected: null,
    });
  }, [editingItem, setDraft]);

  function updateParsingSetting(field, value) {
    setParsingSettings((current) => ({ ...current, [field]: value }));
    setManualParsingSettings(true);
  }

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
    formData.append("default_currency", form.elements.default_currency?.value || "CZK");
    if (manualParsingSettings) {
      formData.append("manual_settings", "1");
      Object.entries(parsingSettings).forEach(([field, value]) => {
        formData.append(field, value ?? "");
      });
    }
    formData.append("sample_size", "5");
    setDetecting(true);
    try {
      const response = await fetch("/api/csv-mappings/detect-columns/", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Column detection failed");
      }
      const nextSettings = { ...defaultParsingSettings, ...(payload.detected_settings || {}) };
      setParsingSettings(nextSettings);
      setManualParsingSettings(false);
      setDraft({
        detected: payload,
        column_map: guessColumnMap(payload.headers),
        categorization_fields: defaultCategorizationFields,
      });
      notify(`Detected ${payload.headers.length} columns`);
    } catch (error) {
      notify(error.message);
    } finally {
      setDetecting(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const duplicateMapping = findDuplicate(refs.mappings, "name", data.name, editingItem?.id);
    data.header_row = Number(data.header_row || 0);
    data.column_map = sanitizeColumnMap(draft.column_map);
    data.categorization_fields = draft.categorization_fields;
    data.fallback_date_formats = [];
    if (duplicateMapping) {
      notify("CSV mapping name already exists");
      form.elements.name?.focus();
      return;
    }
    if (!validateRequiredFields(form, ["default_currency", "delimiter", "quotechar", "encoding", "date_format", "decimal_separator"], notify)) {
      return;
    }
    if (!validateRequiredColumnMap(draft.column_map, notify)) {
      return;
    }
    if (!draft.categorization_fields.length) {
      notify("Choose at least one categorization field");
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/csv-mappings/${editingItem.id}/`, data);
      } else {
        await apiPost("/csv-mappings/", data);
      }
      form.reset();
      clearEditing?.();
      setParsingSettings(defaultParsingSettings);
      setManualParsingSettings(false);
      setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, detected: null });
      notify(isEditing ? "CSV mapping saved" : "CSV mapping added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compact-form mapping-form" key={editingItem?.id || "new-mapping"} onSubmit={submit}>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Mapping name" required /></FormField>
      <FormField label="Default Currency"><input defaultValue={editingItem?.default_currency || "CZK"} maxLength="3" name="default_currency" placeholder="CZK" required /></FormField>
      <label className="mapping-file-field"><span>Sample CSV</span><input accept=".csv,text/csv" name="sample_csv" type="file" /></label>
      <LoadingButton busy={detecting} busyLabel="Detecting" className="link-button mapping-detect-button" disabled={saving} onClick={detectColumns} type="button">Detect Columns</LoadingButton>
      <details className="advanced-settings" open={isEditing || Boolean(draft.detected)}>
        <summary>Advanced parsing settings</summary>
        <div className="advanced-settings-grid">
          <FormField label="Delimiter"><input maxLength="1" name="delimiter" onChange={(event) => updateParsingSetting("delimiter", event.target.value)} placeholder="," required value={parsingSettings.delimiter} /></FormField>
          <FormField label="Date Format"><input name="date_format" onChange={(event) => updateParsingSetting("date_format", event.target.value)} placeholder="%Y-%m-%d" required value={parsingSettings.date_format} /></FormField>
          <FormField label="Encoding"><input name="encoding" onChange={(event) => updateParsingSetting("encoding", event.target.value)} placeholder="utf-8-sig" required value={parsingSettings.encoding} /></FormField>
          <FormField label="Header Row"><input min="0" name="header_row" onChange={(event) => updateParsingSetting("header_row", event.target.value)} placeholder="0" required type="number" value={parsingSettings.header_row} /></FormField>
          <FormField label="Quote Character"><input maxLength="1" name="quotechar" onChange={(event) => updateParsingSetting("quotechar", event.target.value)} placeholder={'"'} required value={parsingSettings.quotechar} /></FormField>
          <FormField label="Decimal Separator"><input maxLength="1" name="decimal_separator" onChange={(event) => updateParsingSetting("decimal_separator", event.target.value)} placeholder="." required value={parsingSettings.decimal_separator} /></FormField>
          <FormField label="Thousands Separator"><input name="thousands_separator" onChange={(event) => updateParsingSetting("thousands_separator", event.target.value)} placeholder="Optional" value={parsingSettings.thousands_separator} /></FormField>
        </div>
      </details>
      {draft.detected?.warnings?.length ? (
        <div className="mapping-warnings">
          {draft.detected.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      ) : null}
      <div className="mapping-column-map">
        {mappingFields.map(([key, label]) => (
          key === "description" ? (
            <DefinitionCheckboxField
              key={key}
              label={label}
              onChange={(next) => setDraft((current) => ({ ...current, column_map: { ...current.column_map, [key]: next } }))}
              options={headers.map((header) => [header, header])}
              placeholder="No columns mapped"
              value={coerceArray(draft.column_map[key])}
            />
          ) : (
            <label className="mapping-column-field" key={key}>
              <span>{label}</span>
              <select
                required={["transaction_date", "amount"].includes(key)}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  column_map: { ...current.column_map, [key]: event.target.value || "" },
                }))}
                value={draft.column_map[key] || ""}
              >
                <option value="">Not mapped</option>
                {headers.map((header) => <option key={header} value={header}>{header}</option>)}
              </select>
            </label>
          )
        ))}
      </div>
      <DefinitionCheckboxField
        className="mapping-categorization-field"
        label="Categorization Fields"
        onChange={(next) => setDraft((current) => ({ ...current, categorization_fields: next }))}
        options={mappingFields.filter(([key]) => !["original_id", "transaction_date", "posted_date", "amount", "currency"].includes(key))}
        placeholder="No categorization fields selected"
        value={draft.categorization_fields}
      />
      {draft.detected && <MappingSample detected={draft.detected} />}
      <FormActions busy={saving} clearEditing={() => {
        clearEditing?.();
        setParsingSettings(defaultParsingSettings);
        setManualParsingSettings(false);
        setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, detected: null });
      }} isEditing={isEditing} />
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

function SimpleForm({ clearEditing, editingItem, endpoint, fields, items = [], notify, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    if (findDuplicate(items, "name", data.name, editingItem?.id)) {
      notify("Name already exists");
      form.elements.name?.focus();
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`${endpoint}${editingItem.id}/`, data);
      } else {
        await apiPost(endpoint, data);
      }
      form.reset();
      clearEditing?.();
      notify(isEditing ? "Record saved" : "Record added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="compact-form" key={editingItem?.id || `${endpoint}-new`} onSubmit={submit}>
      {fields.map(([name, placeholder, required]) => (
        name === "color"
          ? <ColorInput initialValue={editingItem?.[name] || ""} key={name} label={placeholder} name={name} />
          : <FormField key={name} label={placeholder}><input defaultValue={editingItem?.[name] || ""} name={name} placeholder={placeholder} required={required} /></FormField>
      ))}
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
  );
}

function SubcategoryForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    if (!validateRequiredFields(form, ["category_id", "name"], notify)) {
      return;
    }
    if (findDuplicateSubcategory(refs.subcategories, data.category_id, data.name, editingItem?.id)) {
      notify("Subcategory already exists in this category");
      form.elements.name?.focus();
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/subcategories/${editingItem.id}/`, data);
      } else {
        await apiPost("/subcategories/", data);
      }
      form.reset();
      clearEditing?.();
      notify(isEditing ? "Subcategory saved" : "Subcategory added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="compact-form" key={editingItem?.id || "new-subcategory"} onSubmit={submit}>
      <FormField label="Category"><Select defaultValue={editingItem?.category?.id || ""} name="category_id" options={refs.categories.map((item) => [item.id, item.name])} required /></FormField>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Subcategory name" required /></FormField>
      <ColorInput initialValue={editingItem?.color || ""} label="Color" name="color" />
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
  );
}

function ColorInput({ initialValue = "", label = "Color", name }) {
  const [value, setValue] = useState(initialValue || "");
  const wrapperRef = useRef(null);
  const pickerValue = normalizeHexColor(value) || "#58a6ff";

  useEffect(() => {
    setValue(initialValue || "");
  }, [initialValue]);

  useEffect(() => {
    const form = wrapperRef.current?.closest("form");
    if (!form) {
      return undefined;
    }
    function clearColor() {
      setValue("");
    }
    form.addEventListener("reset", clearColor);
    return () => form.removeEventListener("reset", clearColor);
  }, []);

  function updateColor(nextValue) {
    setValue(String(nextValue || "").trim().toUpperCase());
  }

  return (
    <FormField label={label}>
      <div className="color-input" ref={wrapperRef}>
        <input name={name} type="hidden" value={value} />
        <input
          aria-label="Choose color"
          className="color-input-picker"
          onChange={(event) => updateColor(event.target.value)}
          type="color"
          value={pickerValue}
        />
        <input
          className="color-input-text"
          onChange={(event) => updateColor(event.target.value)}
          placeholder="Auto color"
          value={value}
        />
        {value && (
          <button className="color-input-clear" onClick={() => setValue("")} title="Use auto color" type="button">
            Clear
          </button>
        )}
      </div>
    </FormField>
  );
}

function DefinitionCheckboxField({ className = "", label, onChange, options, placeholder = "None selected", value }) {
  const selectedValues = value || [];
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  function toggleOption(optionValue) {
    const next = selectedSet.has(optionValue)
      ? selectedValues.filter((item) => item !== optionValue)
      : [...selectedValues, optionValue];
    onChange(next);
  }

  return (
    <div className={`definition-checkbox-field ${className}`.trim()}>
      <div className="definition-checkbox-header">
        <span>{label}</span>
        <div className="prototype-filter-actions">
          <span className="filter-count">{selectedValues.length ? `${selectedValues.length} selected` : placeholder}</span>
          {selectedValues.length > 0 && (
            <button className="filter-clear inline-clear" onClick={() => onChange([])} type="button">Clear</button>
          )}
        </div>
      </div>
      <div className="definition-checkbox-list">
        {options.length ? options.map(([optionValue, text]) => (
          <label className="checkbox-filter-row" key={optionValue} title={text}>
            <input
              checked={selectedSet.has(optionValue)}
              onChange={() => toggleOption(optionValue)}
              type="checkbox"
            />
            <span>{text}</span>
          </label>
        )) : <div className="filter-no-matches">No options</div>}
      </div>
    </div>
  );
}

function KeywordForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [tagIds, setTagIds] = useState(() => (editingItem?.tags || []).map((item) => item.id));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTagIds((editingItem?.tags || []).map((item) => item.id));
  }, [editingItem]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    data.include_terms = lines(data.include_terms);
    data.exclude_terms = lines(data.exclude_terms);
    if (!data.include_terms.length) {
      notify("Add at least one include term");
      form.elements.include_terms?.focus();
      return;
    }
    data.priority = Number(data.priority || 0);
    data.is_ignored = Boolean(form.elements.is_ignored.checked);
    data.tag_ids = tagIds;
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/keywords/${editingItem.id}/`, data);
      } else {
        await apiPost("/keywords/", data);
      }
      form.reset();
      clearEditing?.();
      notify(isEditing ? "Keyword saved" : "Keyword added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="compact-form keyword-form" key={editingItem?.id || "new-keyword"} onSubmit={submit}>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Keyword name" required /></FormField>
      <FormField label="Include Terms"><textarea defaultValue={(editingItem?.include_terms || []).join("\n")} name="include_terms" placeholder="One term per line" required rows="3" /></FormField>
      <FormField label="Exclude Terms"><textarea defaultValue={(editingItem?.exclude_terms || []).join("\n")} name="exclude_terms" placeholder="One term per line" rows="3" /></FormField>
      <FormField label="Subcategory"><Select blank="No subcategory" defaultValue={editingItem?.subcategory?.id || ""} name="subcategory_id" options={refs.subcategories.map((item) => [item.id, subLabel(item)])} /></FormField>
      <FormField label="Want / Need / Investment"><Select blank="No WNI" defaultValue={editingItem?.want_need_investment || ""} name="want_need_investment" options={wniOptions} /></FormField>
      <DefinitionCheckboxField label="Tags" onChange={setTagIds} options={refs.tags.map((item) => [item.id, item.name])} placeholder="No tags selected" value={tagIds} />
      <FormField label="Priority"><input defaultValue={editingItem?.priority ?? "0"} name="priority" type="number" /></FormField>
      <label className="check-row"><input defaultChecked={Boolean(editingItem?.is_ignored)} name="is_ignored" type="checkbox" /><span>Ignore matches</span></label>
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
  );
}

function ChartPanel({ children, className = "", title }) {
  return <section className={`panel chart-panel ${className}`}><div className="panel-header"><h2>{title}</h2></div>{children}</section>;
}

function MonthlyChart({ hideAmounts, rows }) {
  const monthlyRows = completeMonthlyRows(rows);
  if (!monthlyRows.length) return <EmptyChart />;
  const months = monthlyRows.map((row) => row.month);
  const incomes = monthlyRows.map((row) => row.income);
  const expenses = monthlyRows.map((row) => -row.expense);
  const net = monthlyRows.map((row) => row.net);
  const barWidth = monthlyRows.map(() => 0.78);
  const netColors = monthlyRows.map(() => cssVar("--net-overlay", "rgba(230, 237, 243, 0.26)"));
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[
        {
          customdata: monthlyRows.map((row) => [row.expense, row.net]),
          hovertemplate: hideAmounts ? "Month: %{x}<extra></extra>" : "Month: %{x}<br>Income: %{y:,.0f}<br>Expenses: %{customdata[0]:,.0f}<br>Net: %{customdata[1]:,.0f}<extra></extra>",
          marker: { color: cssVar("--green", "#2f8f65") },
          name: "Income",
          type: "bar",
          width: barWidth,
          x: months,
          y: incomes,
        },
        {
          customdata: monthlyRows.map((row) => [row.expense, row.net]),
          hovertemplate: hideAmounts ? "Month: %{x}<extra></extra>" : "Month: %{x}<br>Expenses: %{customdata[0]:,.0f}<br>Net: %{customdata[1]:,.0f}<extra></extra>",
          marker: { color: cssVar("--red", "#dc2626") },
          name: "Expenses",
          type: "bar",
          width: barWidth,
          x: months,
          y: expenses,
        },
        {
          customdata: monthlyRows.map((row) => [row.income, row.expense]),
          hovertemplate: hideAmounts ? "Month: %{x}<extra></extra>" : "Month: %{x}<br>Net: %{y:,.0f}<br>Income: %{customdata[0]:,.0f}<br>Expenses: %{customdata[1]:,.0f}<extra></extra>",
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
        yaxis: {
          showticklabels: !hideAmounts,
          zeroline: true,
          zerolinecolor: cssVar("--border", "#9facb5"),
          zerolinewidth: 1,
        },
      })}
      useResizeHandler
    />
  );
}

function SunburstChart({ hideAmounts, rows }) {
  if (!rows.length) return <EmptyChart />;
  const { colors, ids, labels, parents, values } = sunburstData(rows);
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        branchvalues: "total",
        hovertemplate: hideAmounts ? "%{label}<extra></extra>" : undefined,
        ids,
        labels,
        marker: { colors },
        parents,
        textinfo: hideAmounts ? "label" : undefined,
        type: "sunburst",
        values,
      }]}
      layout={baseLayout({ extendsunburstcolors: false, margin: { t: 8, r: 8, b: 8, l: 8 }, title: undefined })}
      useResizeHandler
    />
  );
}

function WniChart({ hideAmounts, rows }) {
  const cleanRows = rows.filter((row) => row.amount > 0);
  if (!cleanRows.length) return <EmptyChart />;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        hole: 0.48,
        labels: cleanRows.map((row) => titleCase(row.name)),
        hovertemplate: hideAmounts ? "%{label}<extra></extra>" : undefined,
        marker: { colors: cleanRows.map((row) => wniColor(row.name)) },
        textinfo: hideAmounts ? "label" : undefined,
        type: "pie",
        values: cleanRows.map((row) => row.amount),
      }]}
      layout={baseLayout({ margin: { t: 8, r: 8, b: 8, l: 8 }, showlegend: true })}
      useResizeHandler
    />
  );
}

function TopExpenseChart({ hideAmounts, rows }) {
  const topRows = topExpenseSubcategories(rows);
  if (!topRows.length) return <EmptyChart />;
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        marker: { color: cssVar("--blue", "#58a6ff") },
        orientation: "h",
        hovertemplate: hideAmounts ? "%{y}<extra></extra>" : "%{y}<br>Amount: %{x:,.0f}<extra></extra>",
        text: topRows.map((row) => formatMoneyValue(row.amount, hideAmounts)),
        textposition: "auto",
        type: "bar",
        x: topRows.map((row) => row.amount),
        y: topRows.map((row) => row.label),
      }]}
      layout={baseLayout({
        height: 285,
        margin: { t: 8, r: 18, b: 36, l: 150 },
        xaxis: { showticklabels: !hideAmounts },
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

function CheckboxFilterPanel({ className = "", label, name, onChange, options, value }) {
  const [query, setQuery] = useState("");
  const selectedValues = value || [];
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeName(query);
    if (!normalizedQuery) {
      return options;
    }
    return options.filter(([, text]) => normalizeName(text).includes(normalizedQuery));
  }, [options, query]);

  function toggleOption(optionValue) {
    const next = selectedSet.has(optionValue)
      ? selectedValues.filter((item) => item !== optionValue)
      : [...selectedValues, optionValue];
    onChange(name, next);
  }

  return (
    <div className={`checkbox-filter-panel prototype-filter ${className}`.trim()}>
      <div className="prototype-filter-header">
        <span className="filter-label">{label}</span>
        <span className="filter-count">{selectedValues.length ? `${selectedValues.length} selected` : "All"}</span>
      </div>
      <div className="prototype-filter-tools">
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          type="search"
          value={query}
        />
        {selectedValues.length > 0 && (
          <button className="filter-clear" onClick={() => onChange(name, [])} type="button">Clear</button>
        )}
      </div>
      <div className="checkbox-filter-list">
        {filteredOptions.length ? filteredOptions.map(([optionValue, text]) => (
          <label className="checkbox-filter-row" key={optionValue} title={text}>
            <input
              checked={selectedSet.has(optionValue)}
              onChange={() => toggleOption(optionValue)}
              type="checkbox"
            />
            <span>{text}</span>
          </label>
        )) : <div className="filter-no-matches">No matches</div>}
      </div>
    </div>
  );
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

function Select({ blank, defaultValue = "", name, onChange, options, required = false, value }) {
  const controlledProps = value === undefined ? { defaultValue } : { value };
  return (
    <select {...controlledProps} name={name} onChange={onChange} required={required}>
      {blank && <option value="">{blank}</option>}
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

function LoadingButton({ busy = false, busyLabel = "Working", children, className = "", disabled = false, ...props }) {
  return (
    <button {...props} className={`${className} ${busy ? "is-loading" : ""}`.trim()} disabled={disabled || busy}>
      {busy && <Spinner />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="loading-spinner" />;
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
            <LoadingButton busy={saving} busyLabel="Applying" className="primary-action" onClick={applyTags} type="button">Apply</LoadingButton>
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
    if (["include_ignored", "split_by_owners"].includes(key)) return;
    if (Array.isArray(value) ? value.length : value) {
      params[key] = value;
    }
  });
  if (filters.include_ignored) {
    params.include_ignored = "true";
  }
  if (filters.split_by_owners) {
    params.split_by_owners = "true";
  }
  return params;
}

function buildMetrics(summary, transactionPage, hideAmounts = false) {
  const monthly = summary?.monthly || [];
  const monthCount = monthly.length || 1;
  const income = monthly.reduce((acc, row) => acc + Number(row.income || 0), 0);
  const expense = monthly.reduce((acc, row) => acc + Number(row.expense || 0), 0);
  const net = income - expense;
  const uncategorized = (transactionPage.results || []).filter((row) => !row.category && !row.is_ignored).length;
  return [
    ["Income", formatMoneyValue(income, hideAmounts), "positive", { value: formatMoneyValue(income / monthCount, hideAmounts), tone: "positive" }],
    ["Expenses", formatMoneyValue(expense, hideAmounts), "negative", { value: formatMoneyValue(expense / monthCount, hideAmounts), tone: "negative" }],
    ["Net", formatMoneyValue(net, hideAmounts), "metric-blue", { value: formatMoneyValue(net / monthCount, hideAmounts), tone: "metric-blue" }],
    ["Transactions", `${transactionPage.count.toLocaleString()} / ${(transactionPage.total_count ?? transactionPage.count).toLocaleString()}`, ""],
    ["Uncategorized", uncategorized.toLocaleString(), ""],
  ];
}

function baseLayout(extra = {}) {
  const axisDefaults = {
    color: cssVar("--muted", "#8b949e"),
    gridcolor: cssVar("--border", "#30363d"),
    linecolor: cssVar("--border", "#30363d"),
    tickcolor: cssVar("--border", "#30363d"),
    zerolinecolor: cssVar("--border", "#30363d"),
  };
  const xaxis = { ...axisDefaults, ...(extra.xaxis || {}) };
  const yaxis = { ...axisDefaults, ...(extra.yaxis || {}) };
  return {
    autosize: true,
    colorway: [
      cssVar("--blue", "#58a6ff"),
      cssVar("--orange", "#d29922"),
      cssVar("--green", "#3fb950"),
      cssVar("--violet", "#a371f7"),
      cssVar("--warning", "#d29922"),
      cssVar("--red", "#ff7b72"),
    ],
    font: { color: cssVar("--text", "#e6edf3"), family: "Inter, Segoe UI, sans-serif" },
    height: 285,
    hoverlabel: {
      bgcolor: cssVar("--surface", "#0e1117"),
      bordercolor: cssVar("--border", "#30363d"),
      font: { color: cssVar("--text", "#e6edf3") },
    },
    legend: {
      font: { color: cssVar("--text", "#e6edf3") },
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
    investment: cssVar("--wni-investment", "#d29922"),
    need: cssVar("--wni-need", "#58a6ff"),
    uncategorized: cssVar("--wni-uncategorized", "#8b949e"),
    want: cssVar("--wni-want", "#a371f7"),
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

function buildSidebarAsciiFrame(frame, size) {
  const width = size.columns;
  const height = size.rows;
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  const background = "   .   +   _   ";
  const ribbon = "CA$HMONEY";

  function write(row, col, text) {
    if (row < 0 || row >= height) {
      return;
    }
    String(text).split("").forEach((char, index) => {
      const x = col + index;
      if (x >= 0 && x < width) {
        rows[row][x] = char;
      }
    });
  }

  const time = frame * 0.12;
  for (let y = 0; y < height; y += 1) {
    const rowDrift = Math.sin(y * 0.18 + time * 0.9) * 4 + Math.sin(y * 0.07 - time * 0.55) * 7;
    for (let x = 0; x < width; x += 1) {
      const primaryCenter =
        width / 2 +
        Math.sin(y * 0.21 + time) * width * 0.22 +
        Math.sin(y * 0.055 - time * 0.7) * width * 0.08;
      const secondaryCenter =
        width / 2 +
        Math.sin(y * 0.17 - time * 0.85 + Math.PI) * width * 0.2 +
        Math.sin(y * 0.075 + time * 0.5) * width * 0.07;
      const tertiaryCenter =
        width / 2 +
        Math.sin(y * 0.13 + time * 0.7 + Math.PI / 2) * width * 0.15;
      const distance = Math.min(
        Math.abs(x - primaryCenter),
        Math.abs(x - secondaryCenter),
        Math.abs(x - tertiaryCenter),
      );

      if (distance < 0.9) {
        rows[y][x] = ribbon[Math.abs(Math.floor(x + y + time * 3)) % ribbon.length];
      } else if (distance < 2.5) {
        rows[y][x] = "+";
      } else if (distance < 4.5) {
        rows[y][x] = ".";
      } else {
        const charIndex = Math.abs(Math.floor(x + y * 0.7 + rowDrift + time * 2)) % background.length;
        rows[y][x] = background[charIndex];
      }
    }
  }

  const label = "Cashmoney";
  const labelRow = 7;
  const labelCol = Math.max(0, Math.floor((width - label.length) / 2));
  write(labelRow, labelCol, label);

  return rows.map((row) => row.join("")).join("\n");
}

function findDuplicate(items, field, value, editingId = null) {
  const normalizedValue = normalizeComparable(value);
  if (!normalizedValue) {
    return null;
  }
  return items.find((item) => item.id !== editingId && normalizeComparable(item[field]) === normalizedValue) || null;
}

function findDuplicateSubcategory(items, categoryId, name, editingId = null) {
  const normalizedName = normalizeComparable(name);
  if (!categoryId || !normalizedName) {
    return null;
  }
  return items.find((item) => (
    item.id !== editingId
    && String(item.category?.id || "") === String(categoryId)
    && normalizeComparable(item.name) === normalizedName
  )) || null;
}

function validateRequiredFields(form, names, notify) {
  for (const name of names) {
    const field = form.elements[name];
    const value = String(field?.value ?? "").trim();
    if (!value) {
      notify(`${fieldLabel(name)} is required`);
      field?.focus();
      return false;
    }
  }
  return true;
}

function validateRequiredColumnMap(columnMap, notify) {
  const requiredFields = [
    ["transaction_date", "Transaction Date"],
    ["amount", "Amount"],
  ];
  for (const [key, label] of requiredFields) {
    if (!coerceArray(columnMap[key]).some(Boolean)) {
      notify(`${label} column is required`);
      return false;
    }
  }
  return true;
}

function fieldLabel(name) {
  return String(name || "")
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase();
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

function sanitizeColumnMap(columnMap) {
  const visibleKeys = new Set(mappingFields.map(([key]) => key));
  return Object.fromEntries(Object.entries(columnMap || {}).filter(([key]) => visibleKeys.has(key)));
}

function mappedColumnOptions(headers, columnMap) {
  const options = [];
  const seen = new Set();
  const addOption = (value) => {
    const option = String(value || "");
    if (!option || seen.has(option)) {
      return;
    }
    seen.add(option);
    options.push(option);
  };
  headers.forEach(addOption);
  Object.values(columnMap || {}).flatMap(coerceArray).forEach(addOption);
  return options;
}

function parsingSettingsFromMapping(mapping) {
  if (!mapping) {
    return defaultParsingSettings;
  }
  return {
    delimiter: mapping.delimiter || defaultParsingSettings.delimiter,
    quotechar: mapping.quotechar || defaultParsingSettings.quotechar,
    encoding: mapping.encoding || defaultParsingSettings.encoding,
    header_row: mapping.header_row ?? defaultParsingSettings.header_row,
    date_format: mapping.date_format || defaultParsingSettings.date_format,
    decimal_separator: mapping.decimal_separator || defaultParsingSettings.decimal_separator,
    thousands_separator: mapping.thousands_separator || defaultParsingSettings.thousands_separator,
  };
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

function formatMoneyValue(value, hideAmounts = false) {
  return hideAmounts ? HIDDEN_AMOUNT : money(value);
}

function formatAmountValue(value, hideAmounts = false) {
  return hideAmounts ? HIDDEN_AMOUNT : amountNumber(value);
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
  return luminance > 0.62 ? "#08111d" : "#ffffff";
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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
