import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

import { apiDelete, apiGet, apiPost } from "../api.js";
import { LoadingButton } from "../components.jsx";
import {
  UNASSIGNED,
  baseLayout,
  buildMetrics,
  cloneFilters,
  colorPillStyle,
  completeMonthlyRows,
  countActiveFilters,
  cssVar,
  estimateVisibleTagCount,
  formatAmountValue,
  formatDateInput,
  formatMoneyValue,
  formatNumber,
  getStoredFilterPresets,
  normalizeName,
  storeFilterPresets,
  subLabel,
  subtractRelativeDate,
  sunburstData,
  tagTitle,
  titleCase,
  topExpenseSubcategories,
  wniColor,
  wniOptions,
} from "../shared.js";

ModuleRegistry.registerModules([AllCommunityModule]);

const Plot = createPlotlyComponent(Plotly);
const transactionGridTheme = themeQuartz
  .withParams({
    accentColor: "var(--action)",
    backgroundColor: "var(--bg)",
    borderColor: "var(--border)",
    browserColorScheme: "dark",
    cellTextColor: "var(--text)",
    chromeBackgroundColor: "var(--subtle-bg)",
    dataBackgroundColor: "var(--surface)",
    foregroundColor: "var(--text)",
    headerBackgroundColor: "var(--subtle-bg)",
    headerTextColor: "var(--text)",
    menuBackgroundColor: "var(--surface)",
    oddRowBackgroundColor: "var(--surface)",
    rowHoverColor: "var(--surface-2)",
    selectedRowBackgroundColor: "var(--focus-ring)",
    wrapperBorder: "1px solid var(--border)",
    wrapperBorderRadius: "8px",
  }, "dark")
  .withParams({
    accentColor: "var(--action)",
    backgroundColor: "var(--bg)",
    borderColor: "var(--border)",
    browserColorScheme: "light",
    cellTextColor: "var(--text)",
    chromeBackgroundColor: "var(--subtle-bg)",
    dataBackgroundColor: "var(--surface)",
    foregroundColor: "var(--text)",
    headerBackgroundColor: "var(--subtle-bg)",
    headerTextColor: "var(--text)",
    menuBackgroundColor: "var(--surface)",
    oddRowBackgroundColor: "var(--surface)",
    rowHoverColor: "var(--surface-2)",
    selectedRowBackgroundColor: "var(--focus-ring)",
    wrapperBorder: "1px solid var(--border)",
    wrapperBorderRadius: "8px",
  }, "light");

export default function DashboardPage({
  filters,
  filterParams,
  hideAmounts,
  importBusy,
  notify,
  onFilterChange,
  onToggleHideAmounts,
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
  const conflictIds = useMemo(
    () => new Set(recategorizeResult?.conflict_transaction_ids || []),
    [recategorizeResult],
  );
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [recategorizing, setRecategorizing] = useState(false);
  const [recategorizeLocked, setRecategorizeLocked] = useState(false);
  const [savedFilterName, setSavedFilterName] = useState("");
  const [savedFilters, setSavedFilters] = useState([]);
  const [savedFiltersBusy, setSavedFiltersBusy] = useState(false);
  const localFilterPresetsMigrated = useRef(false);
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const subcategoryFilterOptions = useMemo(() => {
    const selectedCategories = filters.category || [];
    if (!selectedCategories.length) {
      return [[UNASSIGNED, "Unassigned subcategory"], ...refs.subcategories.map((item) => [item.id, subLabel(item)])];
    }
    const selectedCategoryIds = new Set(selectedCategories.filter((item) => item !== UNASSIGNED));
    const options = selectedCategories.includes(UNASSIGNED)
      ? [[UNASSIGNED, "Unassigned subcategory"]]
      : [];
    return [
      ...options,
      ...refs.subcategories
        .filter((item) => selectedCategoryIds.has(item.category?.id))
        .map((item) => [item.id, subLabel(item)]),
    ];
  }, [filters.category, refs.subcategories]);
  const availableSubcategoryValues = useMemo(
    () => new Set(subcategoryFilterOptions.map(([value]) => value)),
    [subcategoryFilterOptions],
  );

  useEffect(() => {
    const selectedSubcategories = filters.subcategory || [];
    const validSubcategories = selectedSubcategories.filter((item) => availableSubcategoryValues.has(item));
    if (validSubcategories.length === selectedSubcategories.length) {
      return;
    }
    setFilters((current) => ({
      ...current,
      subcategory: (current.subcategory || []).filter((item) => availableSubcategoryValues.has(item)),
    }));
  }, [availableSubcategoryValues, filters.subcategory, setFilters]);

  const loadSavedFilters = useCallback(async () => {
    setSavedFiltersBusy(true);
    try {
      let presets = await apiGet("/saved-filters/");
      const localPresets = getStoredFilterPresets();
      if (!localFilterPresetsMigrated.current && localPresets.length) {
        localFilterPresetsMigrated.current = true;
        const existingNames = new Set(presets.map((preset) => preset.name.toLowerCase()));
        const presetsToImport = localPresets.filter((preset) => preset.name && !existingNames.has(preset.name.toLowerCase()));
        if (presetsToImport.length) {
          await Promise.all(presetsToImport.map((preset) => apiPost("/saved-filters/", {
            name: preset.name,
            filters: cloneFilters(preset.filters || {}),
          })));
          presets = await apiGet("/saved-filters/");
        }
        storeFilterPresets([]);
      }
      setSavedFilters(presets);
    } catch (error) {
      notify(error.message);
    } finally {
      setSavedFiltersBusy(false);
    }
  }, [notify]);

  useEffect(() => {
    loadSavedFilters();
  }, [loadSavedFilters]);

  async function saveCurrentFilterPreset(event) {
    event.preventDefault();
    const name = savedFilterName.trim();
    if (!name) {
      notify("Enter a filter name");
      return;
    }
    setSavedFiltersBusy(true);
    try {
      const savedPreset = await apiPost("/saved-filters/", {
        name,
        filters: cloneFilters(filters),
      });
      setSavedFilters((current) => [
        savedPreset,
        ...current.filter((preset) => preset.id !== savedPreset.id && preset.name.toLowerCase() !== savedPreset.name.toLowerCase()),
      ]);
      setSavedFilterName("");
      notify("Filter preset saved");
    } catch (error) {
      notify(error.message);
    } finally {
      setSavedFiltersBusy(false);
    }
  }

  function loadFilterPreset(preset) {
    setFilters((current) => ({
      ...current,
      ...cloneFilters(preset.filters),
    }));
  }

  async function deleteFilterPreset(presetId) {
    setSavedFiltersBusy(true);
    try {
      await apiDelete(`/saved-filters/${presetId}/`);
      setSavedFilters((current) => current.filter((preset) => preset.id !== presetId));
      notify("Filter preset deleted");
    } catch (error) {
      notify(error.message);
    } finally {
      setSavedFiltersBusy(false);
    }
  }

  async function recategorize() {
    if (!transactionPage.count) {
      notify("No filtered transactions");
      return;
    }
    const lockedText = recategorizeLocked ? " Locked transactions included by the current filters will be reset and recategorized." : "";
    if (!window.confirm(`Recategorize ${transactionPage.count.toLocaleString()} filtered transactions?${lockedText}`)) {
      return;
    }
    setRecategorizing(true);
    try {
      const result = await apiPost("/transactions/recategorize/", { include_locked: recategorizeLocked }, filterParams);
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
        <button
          aria-expanded={filtersOpen}
          className="filter-panel-toggle"
          onClick={() => setFiltersOpen((current) => !current)}
          type="button"
        >
          <span>
            <strong>Filters</strong>
            <span>{activeFilterCount ? `${activeFilterCount} active` : "No filters active"}</span>
          </span>
          <span aria-hidden="true">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
        {filtersOpen && (
          <div className="filter-layout">
            <div className="filter-side-stack">
              <div className="filter-card date-filter-card">
                <div className="filter-card-header">
                  <span className="filter-label">Date range</span>
                </div>
                <div className="date-filter-stack">
                  <DateInput label="From" name="date_from" onChange={onFilterChange} value={filters.date_from} />
                  <DateInput label="To" name="date_to" onChange={onFilterChange} value={filters.date_to} />
                </div>
                <RelativeRangeForm setFilters={setFilters} />
              </div>
              <SavedFiltersPanel
                busy={savedFiltersBusy}
                name={savedFilterName}
                onDelete={deleteFilterPreset}
                onLoad={loadFilterPreset}
                onNameChange={setSavedFilterName}
                onSave={saveCurrentFilterPreset}
                presets={savedFilters}
              />
            </div>
            <div className="filter-main-stack">
              <div className="filter-card filter-basics-card">
                <label className="filter-search-field">
                  <span>Search</span>
                  <input onChange={(event) => onFilterChange("q", event.target.value)} placeholder="Description, note, counterparty" type="search" value={filters.q} />
                </label>
                <label className="check-row">
                  <input checked={filters.include_ignored} onChange={(event) => onFilterChange("include_ignored", event.target.checked)} type="checkbox" />
                  <span>Include ignored</span>
                </label>
                <label className="check-row">
                  <input checked={filters.include_locked} onChange={(event) => onFilterChange("include_locked", event.target.checked)} type="checkbox" />
                  <span>Include locked</span>
                </label>
                <label className="check-row">
                  <input checked={filters.split_by_owners} onChange={(event) => onFilterChange("split_by_owners", event.target.checked)} type="checkbox" />
                  <span>Split by owners</span>
                </label>
              </div>
              <div className="filter-group filter-category-group">
                <div className="filter-group-header">
                  <span className="filter-label">Categorization</span>
                </div>
                <div className="filter-category-row">
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
                    options={subcategoryFilterOptions}
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
                </div>
              </div>
              <div className="filter-support-row">
                <CheckboxFilterPanel className="filter-account" label="Account" name="bank_account" onChange={onFilterChange} options={refs.accounts.map((item) => [item.id, item.name])} value={filters.bank_account} />
                <CheckboxFilterPanel
                  className="filter-direction"
                  label="Direction"
                  name="direction"
                  onChange={onFilterChange}
                  options={[["income", "Incomes"], ["expense", "Expenses"]]}
                  searchable={false}
                  value={filters.direction}
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
            </div>
          </div>
        )}
      </section>

      <div className="dashboard-summary-row">
        <section className="filter-panel dashboard-stats-section" aria-labelledby="dashboard-stats-title">
          <h2 id="dashboard-stats-title" className="dashboard-section-title">Stats</h2>
          <div className="metrics-grid">
            {metrics.map(([label, value, tone, secondary], index) => (
              <div className={`metric stats-metric stats-metric-${index + 1}`} key={label}>
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
          </div>
        </section>

        <section className="filter-panel dashboard-action-card" aria-labelledby="dashboard-actions-title">
          <h2 id="dashboard-actions-title" className="dashboard-section-title">Actions</h2>
          <div className="dashboard-action-section">
            <div className="dashboard-action-subsection dashboard-privacy-action">
              <button
                aria-label={hideAmounts ? "Show amounts" : "Hide amounts"}
                aria-pressed={hideAmounts}
                className={`link-button privacy-toggle dashboard-icon-action ${hideAmounts ? "is-active" : ""}`}
                onClick={onToggleHideAmounts}
                title={hideAmounts ? "Show amounts" : "Hide amounts"}
                type="button"
              >
                {hideAmounts ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <div className="dashboard-action-subsection dashboard-recategorize-action">
              <label className="check-row recategorize-locked-toggle">
                <input checked={recategorizeLocked} onChange={(event) => setRecategorizeLocked(event.target.checked)} type="checkbox" />
                <span>Include locked</span>
              </label>
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
        </section>
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
        <TransactionGrid conflictIds={conflictIds} hideAmounts={hideAmounts} notify={notify} refs={refs} rows={transactionPage.results} updateTransaction={updateTransaction} />
      </section>
    </>
  );
}

function IconSvg({ children }) {
  return (
    <svg aria-hidden="true" className="icon-svg" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      {children}
    </svg>
  );
}

function EyeIcon() {
  return (
    <IconSvg>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </IconSvg>
  );
}

function EyeOffIcon() {
  return (
    <IconSvg>
      <path d="m3 3 18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.2 17.2 0 0 1-2.2 3.2" />
      <path d="M6.2 6.5C3.5 8.2 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.2-.8" />
    </IconSvg>
  );
}

function LockIcon({ locked }) {
  return (
    <IconSvg>
      {locked ? (
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      ) : (
        <path d="M7 11V7a5 5 0 0 1 9.5-2.2" />
      )}
      <rect height="10" rx="2" width="14" x="5" y="11" />
    </IconSvg>
  );
}

function TransactionGrid({ conflictIds, hideAmounts, notify, refs, rows, updateTransaction }) {
  const subcategoryOptions = useMemo(() => ["", ...refs.subcategories.map((item) => item.id)], [refs.subcategories]);
  const subcategoryLookup = useMemo(() => new Map(refs.subcategories.map((item) => [item.id, item])), [refs.subcategories]);
  const categoryLookup = useMemo(() => new Map(refs.categories.map((item) => [item.id, item])), [refs.categories]);
  const accountLookup = useMemo(() => new Map(refs.accounts.map((item) => [item.id, item.name])), [refs.accounts]);

  const rowData = useMemo(() => rows.map((row) => ({
    ...row,
    account_id: row.bank_account?.id || "",
    categorization_conflict: conflictIds.has(row.id),
    subcategory_id: row.subcategory?.id || "",
  })), [conflictIds, rows]);

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
        if (params.data?.categorization_conflict) {
          return <ConflictCell />;
        }
        const category = categoryLookup.get(params.value?.id);
        return <ColorCell color={category?.color} label={params.value?.name || "Unassigned"} muted={!params.value} />;
      },
      valueFormatter: (params) => params.value?.name || "Unassigned",
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      width: 150,
    },
    {
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: subcategoryOptions },
      editable: true,
      field: "subcategory_id",
      headerClass: "editable-header",
      headerName: "Subcategory",
      cellRenderer: (params) => {
        if (params.data?.categorization_conflict) {
          return <ConflictCell />;
        }
        const subcategory = subcategoryLookup.get(params.value);
        return <ColorCell color={subcategory?.color} label={subcategory?.name || "Unassigned"} muted={!subcategory} />;
      },
      valueFormatter: (params) => {
        const subcategory = subcategoryLookup.get(params.value);
        return subcategory?.name || "Unassigned";
      },
      cellClass: (params) => `editable-cell ${!params.value ? "muted-cell" : ""}`,
      width: 170,
    },
    {
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["", "want", "need", "investment"] },
      editable: true,
      field: "want_need_investment",
      headerClass: "editable-header",
      headerName: "WNI",
      cellRenderer: (params) => <WniCell value={params.value} />,
      valueFormatter: (params) => (params.value ? titleCase(params.value) : "Unassigned"),
      cellClass: (params) => `editable-cell ${!params.value ? "muted-cell" : ""}`,
      width: 135,
    },
    {
      field: "tags",
      headerClass: "editable-header",
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
      valueFormatter: (params) => (params.value || []).map((tag) => tag.name).join(", ") || "No tags",
      sortable: false,
      flex: 1,
      minWidth: 240,
    },
    {
      field: "is_ignored",
      headerClass: "editable-header",
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
    {
      cellClass: "lock-cell",
      field: "is_categorization_locked",
      headerName: "Locked",
      cellRenderer: (params) => {
        const locked = Boolean(params.value);
        return (
          <button
            aria-label={locked ? "Unlock categorization" : "Lock categorization"}
            aria-pressed={locked}
            className={`lock-cell-button ${locked ? "is-locked" : ""}`}
            onClick={async (event) => {
              event.stopPropagation();
              try {
                await updateTransaction(params.data, { is_categorization_locked: !locked });
                notify(locked ? "Transaction unlocked" : "Transaction locked");
              } catch (error) {
                notify(error.message);
              }
            }}
            title={locked ? "Unlock categorization" : "Lock categorization"}
            type="button"
          >
            <LockIcon locked={locked} />
          </button>
        );
      },
      valueFormatter: (params) => (params.value ? "Locked" : "Unlocked"),
      width: 96,
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
    <div className="transaction-grid">
      <AgGridReact
        columnDefs={columnDefs}
        defaultColDef={{ resizable: true, sortable: true }}
        enableCellTextSelection
        ensureDomOrder
        onCellValueChanged={onCellValueChanged}
        rowData={rowData}
        rowHeight={48}
        stopEditingWhenCellsLoseFocus
        theme={transactionGridTheme}
      />
    </div>
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
      details: <ConflictDetailList details={conflictDetails} />,
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
  const detailCount = metric.detailCount ?? (transactions.length || ids.length);
  const hasDetails = Boolean(detailCount);
  return (
    <div className={`metric recategorize-metric${hasDetails ? " metric-has-details" : ""}`}>
      <div className="metric-label">{metric.label}</div>
      <div className="metric-value">{count.toLocaleString()}</div>
      {hasDetails ? (
        <details className="metric-details">
          <summary>{detailCount.toLocaleString()} details</summary>
          {metric.details || (transactions.length ? <TransactionSummaryList transactions={transactions} /> : <TransactionIdList ids={ids} />)}
        </details>
      ) : (
        <div className="metric-empty-detail">No details</div>
      )}
    </div>
  );
}

function TransactionIdList({ ids }) {
  const visibleIds = ids.slice(0, 40);
  return (
    <div className="metric-id-list">
      {visibleIds.map((id) => <code key={id}>{id}</code>)}
      {ids.length > visibleIds.length ? (
        <span className="muted">+{(ids.length - visibleIds.length).toLocaleString()} more</span>
      ) : null}
    </div>
  );
}

function TransactionSummaryList({ transactions }) {
  const visibleTransactions = transactions.slice(0, 40);
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
      {transactions.length > visibleTransactions.length ? (
        <span className="muted">+{(transactions.length - visibleTransactions.length).toLocaleString()} more</span>
      ) : null}
    </div>
  );
}

function ConflictDetailList({ details }) {
  if (!details.length) {
    return null;
  }
  const visibleDetails = details.slice(0, 20);
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
      {details.length > visibleDetails.length ? (
        <div className="muted">+{(details.length - visibleDetails.length).toLocaleString()} more conflicts</div>
      ) : null}
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
      <div className="relative-range-title">Set date range to last</div>
      <label><span>Amount</span><input min="1" onChange={(event) => setCount(event.target.value)} step="1" type="number" value={count} /></label>
      <label><span>Unit</span><select onChange={(event) => setUnit(event.target.value)} value={unit}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label>
      <button className="link-button" type="submit">Apply date range</button>
    </form>
  );
}

function SavedFiltersPanel({ busy, name, onDelete, onLoad, onNameChange, onSave, presets }) {
  return (
    <div className="filter-card saved-filters-card">
      <div className="filter-card-header">
        <span className="filter-label">Saved filters</span>
        <span className="muted">{busy ? "Syncing" : ""}</span>
      </div>
      <form className="saved-filter-form" onSubmit={onSave}>
        <label>
          <span>Preset name</span>
          <input
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Example: Cash withdrawals"
            value={name}
          />
        </label>
        <button className="link-button" disabled={busy} type="submit">Save current filters</button>
      </form>
      <div className="saved-filter-list">
        {presets.length ? presets.map((preset) => (
          <div className="saved-filter-row" key={preset.id}>
            <button disabled={busy} onClick={() => onLoad(preset)} type="button">
              <span>{preset.name}</span>
              <small>{countActiveFilters(preset.filters).toLocaleString()} filters</small>
            </button>
            <button aria-label={`Delete ${preset.name}`} className="icon-button" disabled={busy} onClick={() => onDelete(preset.id)} type="button">x</button>
          </div>
        )) : <div className="saved-filter-empty">No saved filters yet</div>}
      </div>
    </div>
  );
}

function DateInput({ label, name, onChange, value }) {
  return (
    <label>
      <span>{label}</span>
      <input
        inputMode="numeric"
        onChange={(event) => onChange(name, event.target.value)}
        pattern="\d{4}-\d{2}-\d{2}"
        placeholder="YYYY-MM-DD"
        type="text"
        value={value}
      />
    </label>
  );
}

function CheckboxFilterPanel({ className = "", label, name, onChange, options, searchable = true, value }) {
  const [query, setQuery] = useState("");
  const selectedValues = value || [];
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const canSelectAll = selectedValues.length < options.length;
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
        <span className="filter-count">{selectedValues.length ? `${selectedValues.length} selected` : "None"}</span>
      </div>
      <div className={`prototype-filter-tools${searchable ? "" : " no-search"}`}>
        {searchable && (
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            type="search"
            value={query}
          />
        )}
        <div className="prototype-filter-buttons">
          <button className="filter-clear" disabled={!canSelectAll} onClick={() => onChange(name, options.map(([optionValue]) => optionValue))} type="button">Select all</button>
          <button className="filter-clear" disabled={selectedValues.length === 0} onClick={() => onChange(name, [])} type="button">Clear</button>
        </div>
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


function ConflictCell() {
  return <span className="color-cell conflict-cell"><span className="color-cell-label">Conflict</span></span>;
}

function ColorCell({ color, label, muted = false }) {
  if (muted) {
    return <span className="color-cell color-cell-muted"><span className="color-cell-label">{label}</span></span>;
  }
  return <span className="color-cell" style={colorPillStyle(color)}><span className="color-cell-label">{label}</span></span>;
}

function WniCell({ value }) {
  if (!value) {
    return <span className="color-cell color-cell-muted"><span className="color-cell-label">Unassigned</span></span>;
  }
  return <span className="color-cell" style={colorPillStyle(wniColor(value))}><span className="color-cell-label">{titleCase(value)}</span></span>;
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
                <span className="tag-option-check">{selectedSet.has(tag.id) ? "âœ“" : ""}</span>
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
