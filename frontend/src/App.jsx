import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiGet, apiPatch, BACKEND_REACHABILITY_EVENT } from "./api.js";
import { ConfirmDialog, ModalShell, Spinner } from "./components.jsx";
import { EyeIcon, EyeOffIcon, MoonIcon, SunIcon } from "./icons.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import SidebarAsciiPlay from "./SidebarAsciiPlay.jsx";
import {
  accentPresets,
  applyAccent,
  applyTheme,
  buildFilterParams,
  DASHBOARD_TAB_STORAGE_KEY,
  defaultAccentForTheme,
  defaultCategorizationFields,
  emptyFilters,
  getStoredAccent,
  getStoredHideAmounts,
  getStoredTheme,
  HIDE_AMOUNTS_STORAGE_KEY,
  initialChecklistFilters,
  isChunkLoadError,
  normalizeHexColor,
  pages,
  readStoredChoice,
  storeChoice,
  syncChecklistFilters,
  toastDuration,
  todayInputValue,
} from "./shared.js";

const ImportPage = lazy(() => import("./pages/ImportPage.jsx"));
const DefinitionsPage = lazy(() => import("./pages/DefinitionsPage.jsx"));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage.jsx"));
const HelpPage = lazy(() => import("./pages/HelpPage.jsx"));
const DASHBOARD_TRANSACTION_LOAD_DELAY_MS = 180;

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [dashboardTab, setDashboardTab] = useState(
    () => readStoredChoice(DASHBOARD_TAB_STORAGE_KEY, ["overview", "transactions"], "overview"),
  );
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
  const [loadingDashboardSummary, setLoadingDashboardSummary] = useState(false);
  const [loadingDashboardTransactions, setLoadingDashboardTransactions] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [maintenanceSummary, setMaintenanceSummary] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [mappingDraft, setMappingDraft] = useState({
    column_map: {},
    categorization_fields: defaultCategorizationFields,
    available_headers: [],
    detected: null,
  });
  const loadedFilterRefs = useRef(null);
  const confirmationResolver = useRef(null);
  const dashboardLoadSequence = useRef(0);
  const dashboardSummarySequence = useRef(0);
  // The filter params of the last summary and transaction list loads, and whether data
  // changed since (CR-27: no background reloads while the dashboard is hidden). The list
  // loads only on the Transactions tab, so the two can be out of step.
  const loadedSummaryKey = useRef("");
  const summaryStale = useRef(false);
  const loadedTransactionsKey = useRef("");
  const transactionsStale = useRef(false);

  const toastTimer = useRef(null);
  const hideToastIn = useCallback((milliseconds) => {
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), milliseconds);
  }, []);
  const notify = useCallback((message) => {
    setToast(message);
    hideToastIn(toastDuration(message));
  }, [hideToastIn]);
  // Reading a toast (pointer over it, or keyboard focus on its close button) keeps it.
  const holdToast = useCallback(() => window.clearTimeout(toastTimer.current), []);
  const releaseToast = useCallback(() => hideToastIn(1500), [hideToastIn]);
  const dismissToast = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast("");
  }, []);

  // api.js reports when the backend stops (or starts) answering at all.
  useEffect(() => {
    const onReachability = (event) => setStatus(event.detail.reachable ? "Backend online" : "Backend offline");
    window.addEventListener(BACKEND_REACHABILITY_EVENT, onReachability);
    return () => window.removeEventListener(BACKEND_REACHABILITY_EVENT, onReachability);
  }, []);

  const confirmAction = useCallback((options) => {
    if (confirmationResolver.current) {
      confirmationResolver.current(false);
    }
    return new Promise((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation({
        cancelLabel: options.cancelLabel || "Cancel",
        confirmLabel: options.confirmLabel || "Confirm",
        danger: Boolean(options.danger),
        message: options.message || "",
        title: options.title || "Confirm Action",
      });
    });
  }, []);

  const closeConfirmation = useCallback((confirmed) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => () => {
    confirmationResolver.current?.(false);
    confirmationResolver.current = null;
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
    const nextRefs = { accounts, mappings, categories, subcategories, tags, keywords, settings };
    const previousRefs = loadedFilterRefs.current;
    loadedFilterRefs.current = nextRefs;
    setRefs(nextRefs);
    setFilters((current) => (
      previousRefs
        ? syncChecklistFilters(current, previousRefs, nextRefs)
        : { ...current, ...initialChecklistFilters(nextRefs) }
    ));
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

  const builtFilterParams = useMemo(() => buildFilterParams(filters), [filters]);
  const filterParamsKey = JSON.stringify(builtFilterParams);
  // The same object while the query stays the same: loadAll() re-syncs the filters
  // after every definitions save, and a new object reloaded the whole dashboard.
  const filterParams = useMemo(() => builtFilterParams, [filterParamsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dashboardVisible = activePage === "dashboard";
  const dashboardBusy = loadingDashboardSummary || loadingDashboardTransactions;

  const runSummaryLoad = useCallback(async (params, summarySequence) => {
    if (summarySequence !== dashboardSummarySequence.current) {
      return;
    }
    setLoadingDashboardSummary(true);
    try {
      const nextSummary = await apiGet("/dashboard/summary/", params);
      if (summarySequence === dashboardSummarySequence.current) {
        setSummary(nextSummary);
      }
    } catch (error) {
      if (summarySequence === dashboardSummarySequence.current) {
        notify(error.message);
      }
    } finally {
      if (summarySequence === dashboardSummarySequence.current) {
        setLoadingDashboardSummary(false);
      }
    }
  }, [notify]);

  const runTransactionsLoad = useCallback(async (params, loadSequence) => {
    if (loadSequence !== dashboardLoadSequence.current) {
      return;
    }
    setLoadingDashboardTransactions(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, DASHBOARD_TRANSACTION_LOAD_DELAY_MS));
      if (loadSequence !== dashboardLoadSequence.current) {
        return;
      }
      const nextTransactions = await apiGet("/transactions/", { ...params, limit: 10000 });
      if (loadSequence === dashboardLoadSequence.current) {
        setTransactionPage(nextTransactions);
      }
    } catch (error) {
      if (loadSequence === dashboardLoadSequence.current) {
        notify(error.message);
      }
    } finally {
      if (loadSequence === dashboardLoadSequence.current) {
        setLoadingDashboardTransactions(false);
      }
    }
  }, [notify]);

  const loadDashboardSummary = useCallback(async () => {
    const summarySequence = dashboardSummarySequence.current + 1;
    dashboardSummarySequence.current = summarySequence;
    setLoadingDashboardSummary(true);
    try {
      const nextSummary = await apiGet("/dashboard/summary/", filterParams);
      if (summarySequence === dashboardSummarySequence.current) {
        setSummary(nextSummary);
      }
    } catch (error) {
      if (summarySequence === dashboardSummarySequence.current) {
        notify(error.message);
      }
    } finally {
      if (summarySequence === dashboardSummarySequence.current) {
        setLoadingDashboardSummary(false);
      }
    }
  }, [filterParams, notify]);

  // Data changed (an action or another page): reload what's shown, mark the rest stale.
  const loadDashboard = useCallback(async (params = filterParams) => {
    if (!dashboardVisible) {
      // Another page changed data; load when the dashboard is shown again.
      summaryStale.current = true;
      transactionsStale.current = true;
      return;
    }
    const summarySequence = dashboardSummarySequence.current + 1;
    dashboardSummarySequence.current = summarySequence;
    const loads = [runSummaryLoad(params, summarySequence)];
    if (dashboardTab === "transactions") {
      const loadSequence = dashboardLoadSequence.current + 1;
      dashboardLoadSequence.current = loadSequence;
      loads.push(runTransactionsLoad(params, loadSequence));
    } else {
      transactionsStale.current = true;
    }
    await Promise.allSettled(loads);
  }, [dashboardTab, dashboardVisible, filterParams, runSummaryLoad, runTransactionsLoad]);

  const changeDashboardTab = useCallback((tab) => {
    setDashboardTab(tab);
    storeChoice(DASHBOARD_TAB_STORAGE_KEY, tab);
  }, []);

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

  // The summary loads when the filters changed since its last load, or when another page
  // asked for fresh data while the dashboard was hidden; not on every page switch.
  useEffect(() => {
    if (!(filterDefaults.to || filterDefaults.from) || !dashboardVisible) {
      return undefined;
    }
    if (!summaryStale.current && loadedSummaryKey.current === filterParamsKey) {
      return undefined;
    }
    const summarySequence = dashboardSummarySequence.current + 1;
    dashboardSummarySequence.current = summarySequence;
    const timeoutId = window.setTimeout(() => {
      summaryStale.current = false;
      loadedSummaryKey.current = filterParamsKey;
      runSummaryLoad(filterParams, summarySequence);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [dashboardVisible, filterDefaults.from, filterDefaults.to, filterParams, filterParamsKey, runSummaryLoad]);

  // The transaction list loads the same way, but only while the Transactions tab is
  // shown: the Overview needs just the summary, and the list is the heavy request.
  useEffect(() => {
    if (!(filterDefaults.to || filterDefaults.from) || !dashboardVisible || dashboardTab !== "transactions") {
      return undefined;
    }
    if (!transactionsStale.current && loadedTransactionsKey.current === filterParamsKey) {
      return undefined;
    }
    const loadSequence = dashboardLoadSequence.current + 1;
    dashboardLoadSequence.current = loadSequence;
    const timeoutId = window.setTimeout(() => {
      transactionsStale.current = false;
      loadedTransactionsKey.current = filterParamsKey;
      runTransactionsLoad(filterParams, loadSequence);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [dashboardTab, dashboardVisible, filterDefaults.from, filterDefaults.to, filterParams, filterParamsKey, runTransactionsLoad]);

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

  const updateTransaction = useCallback(async (transaction, patch) => {
    const updated = await apiPatch(`/transactions/${transaction.id}/`, patch, filterParams);
    setTransactionPage((current) => ({
      ...current,
      results: current.results.map((item) => (item.id === updated.id ? updated : item)),
    }));
    loadDashboardSummary();
    return updated;
  }, [filterParams, loadDashboardSummary]);

  const deleteTransaction = useCallback(async (transaction) => {
    await apiDelete(`/transactions/${transaction.id}/`);
    setTransactionPage((current) => ({
      ...current,
      count: Math.max(0, (current.count || 0) - 1),
      total_count: Math.max(0, (current.total_count || 0) - 1),
      results: current.results.filter((item) => item.id !== transaction.id),
    }));
    loadDashboardSummary();
  }, [loadDashboardSummary]);

  const title = pages[activePage];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <SidebarAsciiPlay />
        <nav className="nav-tabs" aria-label="Primary">
          {Object.entries(pages).map(([key, label]) => (
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
        <div className="sidebar-footer" aria-label="Display preferences">
          <button
            aria-label="Choose accent color"
            className="sidebar-tool-button accent-picker-trigger"
            onClick={() => setIsAccentPickerOpen(true)}
            title="Choose accent color"
            type="button"
          >
            <span className="accent-swatch" style={{ background: accent || defaultAccentForTheme(theme) }} />
          </button>
          <button
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={theme === "light"}
            className="sidebar-tool-button theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            type="button"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            aria-label={hideAmounts ? "Show amounts" : "Hide amounts"}
            aria-pressed={hideAmounts}
            className={`sidebar-tool-button privacy-toggle amount-toggle ${hideAmounts ? "is-active" : ""}`.trim()}
            onClick={toggleHideAmounts}
            title={hideAmounts ? "Show amounts" : "Hide amounts"}
            type="button"
          >
            {hideAmounts ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{title}</h1>
        </header>
        {status === "Backend offline" ? (
          <div className="backend-offline-banner" role="alert">
            <span>Can't reach the Cashmoney backend, so nothing loads or saves right now.</span>
            <button className="link-button" onClick={loadAll} type="button">Retry</button>
          </div>
        ) : null}

        <PageErrorBoundary key={activePage}>
          {activePage === "dashboard" && (
            <DashboardPage
              dashboardTab={dashboardTab}
              filterDefaults={filterDefaults}
              onDashboardTabChange={changeDashboardTab}
              filters={filters}
              hideAmounts={hideAmounts}
              importBusy={dashboardBusy}
              summaryBusy={loadingDashboardSummary}
              transactionsBusy={loadingDashboardTransactions}
              onFilterChange={updateFilter}
              refs={refs}
              recategorizeResult={recategorizeResult}
              reloadAll={loadAll}
              setFilters={setFilters}
              setRecategorizeResult={setRecategorizeResult}
              summary={summary}
              transactionPage={transactionPage}
              deleteTransaction={deleteTransaction}
              updateTransaction={updateTransaction}
              filterParams={filterParams}
              confirmAction={confirmAction}
              notify={notify}
              reloadDashboard={loadDashboard}
            />
          )}
          <Suspense fallback={<PageFallback />}>
            {activePage === "import" && (
              <ImportPage confirmAction={confirmAction} hideAmounts={hideAmounts} importReport={importReport} notify={notify} refs={refs} reloadAll={loadAll} reloadDashboard={loadDashboard} setImportReport={setImportReport} />
            )}
            {activePage === "settings" && (
              <DefinitionsPage
                mappingDraft={mappingDraft}
                confirmAction={confirmAction}
                notify={notify}
                refs={refs}
                reloadAll={loadAll}
                reloadDashboard={loadDashboard}
                setMappingDraft={setMappingDraft}
              />
            )}
            {activePage === "maintenance" && (
              <MaintenancePage
                notify={notify}
                confirmAction={confirmAction}
                reloadAll={loadAll}
                reloadDashboard={loadDashboard}
                reloadMaintenance={loadMaintenance}
                summary={maintenanceSummary}
              />
            )}
            {activePage === "help" && <HelpPage />}
          </Suspense>
        </PageErrorBoundary>
      </main>
      {isAccentPickerOpen && (
        <AccentModal
          accent={accent}
          onApply={updateAccent}
          onClose={() => setIsAccentPickerOpen(false)}
          theme={theme}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          cancelLabel={confirmation.cancelLabel}
          confirmLabel={confirmation.confirmLabel}
          danger={confirmation.danger}
          message={confirmation.message}
          onCancel={() => closeConfirmation(false)}
          onConfirm={() => closeConfirmation(true)}
          title={confirmation.title}
        />
      )}
      <div
        aria-atomic="true"
        aria-live="polite"
        className={`toast ${toast ? "is-visible" : ""}`}
        onBlur={releaseToast}
        onFocus={holdToast}
        onMouseEnter={holdToast}
        onMouseLeave={releaseToast}
        role="status"
      >
        {toast ? (
          <>
            <span className="toast-message">{toast}</span>
            <button aria-label="Dismiss message" className="toast-close" onClick={dismissToast} type="button">×</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function AccentModal({ accent, onApply, onClose, theme }) {
  const fallbackAccent = defaultAccentForTheme(theme);
  const appliedAccent = normalizeHexColor(accent || fallbackAccent) || fallbackAccent;
  const [draftAccent, setDraftAccent] = useState(appliedAccent);

  useEffect(() => {
    setDraftAccent(appliedAccent);
  }, [appliedAccent]);

  return (
    <ModalShell
      className="accent-modal"
      closeLabel="Close accent picker"
      headerClassName="accent-modal-header"
      onClose={onClose}
      title="Accent"
      titleId="accent-modal-title"
    >
        <label className="accent-custom-picker">
          <span>Custom color</span>
          <input
            onChange={(event) => setDraftAccent(event.target.value)}
            type="color"
            value={draftAccent || appliedAccent}
          />
        </label>
        <button className="primary-action accent-confirm-button" onClick={() => onApply(draftAccent || fallbackAccent)} type="button">
          Apply custom color
        </button>
        <div className="accent-preset-label">Presets</div>
        <div className="accent-preset-grid">
          {accentPresets.map((color) => {
            const isSelected = appliedAccent.toLowerCase() === color.toLowerCase();
            return (
              <button
                aria-label={`Use accent ${color}`}
                aria-pressed={isSelected}
                className={`accent-preset ${isSelected ? "is-selected" : ""}`}
                key={color}
                onClick={() => onApply(color)}
                title={color}
                style={{ "--preset-color": color }}
                type="button"
              >
                <span className="accent-preset-swatch" />
              </button>
            );
          })}
        </div>
    </ModalShell>
  );
}

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("Page render failed", error);
  }

  render() {
    const { error } = this.state;
    if (error && isChunkLoadError(error)) {
      // React keeps the failed import, so only a reload can fetch the page's code again.
      return (
        <section className="panel page-error-panel">
          <div>
            <h2>This page can't load right now</h2>
            <p>Its code comes from the Cashmoney backend, which isn't answering. Reload once the backend is running again.</p>
          </div>
          <button className="link-button" onClick={() => window.location.reload()} type="button">
            Reload
          </button>
        </section>
      );
    }
    if (error) {
      return (
        <section className="panel page-error-panel">
          <div>
            <h2>Page failed to render</h2>
            <p>{error.message || "An unexpected frontend error occurred."}</p>
          </div>
          <button className="link-button" onClick={() => this.setState({ error: null })} type="button">
            Try again
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

function PageFallback() {
  return (
    <div className="panel inline-status">
      <Spinner />
      Loading page
    </div>
  );
}
