import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiGet, apiPatch, BACKEND_REACHABILITY_EVENT } from "./api.js";
import { ConfirmDialog, ModalShell, Spinner } from "./components.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import {
  accentPresets,
  applyAccent,
  applyTheme,
  buildFilterParams,
  buildSidebarAsciiFrame,
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
  // The filter params of the last dashboard load, and whether another page changed
  // data since (CR-27: no background reloads while the dashboard is hidden).
  const loadedDashboardKey = useRef("");
  const dashboardStale = useRef(false);

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

  const runDashboardLoad = useCallback(async (params, loadSequence, summarySequence) => {
    if (loadSequence !== dashboardLoadSequence.current) {
      return;
    }
    const summaryPromise = (async () => {
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
    })();

    const transactionsPromise = (async () => {
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
    })();

    await Promise.allSettled([summaryPromise, transactionsPromise]);
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

  const loadDashboard = useCallback(async (params = filterParams) => {
    if (!dashboardVisible) {
      // Another page changed data; load when the dashboard is shown again.
      dashboardStale.current = true;
      return;
    }
    const loadSequence = dashboardLoadSequence.current + 1;
    const summarySequence = dashboardSummarySequence.current + 1;
    dashboardLoadSequence.current = loadSequence;
    dashboardSummarySequence.current = summarySequence;
    await runDashboardLoad(params, loadSequence, summarySequence);
  }, [dashboardVisible, filterParams, runDashboardLoad]);

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
    if (!(filterDefaults.to || filterDefaults.from) || !dashboardVisible) {
      return undefined;
    }
    // Load when the filters changed since the last load, or when another page asked
    // for fresh data while the dashboard was hidden; not on every page switch.
    if (!dashboardStale.current && loadedDashboardKey.current === filterParamsKey) {
      return undefined;
    }
    const loadSequence = dashboardLoadSequence.current + 1;
    const summarySequence = dashboardSummarySequence.current + 1;
    dashboardLoadSequence.current = loadSequence;
    dashboardSummarySequence.current = summarySequence;
    const timeoutId = window.setTimeout(() => {
      dashboardStale.current = false;
      loadedDashboardKey.current = filterParamsKey;
      runDashboardLoad(filterParams, loadSequence, summarySequence);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [dashboardVisible, filterDefaults.from, filterDefaults.to, filterParams, filterParamsKey, runDashboardLoad]);

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
          <div>
            <h1>{title}</h1>
            <p>{kicker}</p>
          </div>
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
              filterDefaults={filterDefaults}
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

function IconSvg({ children }) {
  return (
    <svg aria-hidden="true" className="icon-svg" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      {children}
    </svg>
  );
}

function MoonIcon() {
  return (
    <IconSvg>
      <path d="M12 3a6.8 6.8 0 0 0 9 8.9A9 9 0 1 1 12 3Z" />
    </IconSvg>
  );
}

function SunIcon() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </IconSvg>
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

function PageFallback() {
  return (
    <div className="panel inline-status">
      <Spinner />
      Loading page
    </div>
  );
}

const SIDEBAR_FRAME_MS = 33; // about 30 frames a second
const SIDEBAR_IDLE_MS = 2 * 60 * 1000; // stop after two minutes without input

function SidebarAsciiPlay() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) {
      return undefined;
    }

    const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let running = false;
    let animationFrame = 0;
    let timer = 0;
    let idleTimer = 0;
    let lastActivity = 0;
    let lastDraw = 0;
    let width = 0;
    let height = 0;
    let columns = 34;
    let rows = 64;
    let characterHeight = 10.6;
    let color = "";

    function updateSize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
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

    // The color changes only with the theme or accent; reading it every frame was waste.
    function updateColor() {
      color = window.getComputedStyle(canvas).color;
    }

    function renderFrame(timestamp) {
      // The narrow layout hides the canvas (display: none): nothing to draw.
      if (!width || !height) {
        return;
      }
      context.fillStyle = color;
      context.clearRect(0, 0, width, height);
      const content = buildSidebarAsciiFrame(timestamp / 120, { columns, rows });
      content.split("\n").forEach((line, index) => {
        context.fillText(line, 0, index * characterHeight);
      });
    }

    function draw(timestamp) {
      if (!running) {
        return;
      }
      if (timestamp - lastDraw >= SIDEBAR_FRAME_MS - 1) {
        lastDraw = timestamp;
        renderFrame(timestamp);
      }
      // Wait on a timer until shortly before the next frame is due, instead of waking on
      // every display refresh (60 to 144 times a second) only to skip it.
      const wait = Math.max(0, lastDraw + SIDEBAR_FRAME_MS - timestamp - 12);
      timer = window.setTimeout(() => {
        animationFrame = window.requestAnimationFrame(draw);
      }, wait);
    }

    function start() {
      if (animate && !running && width && height && document.hasFocus()) {
        running = true;
        animationFrame = window.requestAnimationFrame(draw);
      }
    }

    function stop() {
      running = false;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
    }

    // The animation is decoration, so it stops while nobody is using the app: when the
    // window loses focus, or after a while without input. The last frame stays.
    function checkIdle() {
      const idleFor = performance.now() - lastActivity;
      if (idleFor >= SIDEBAR_IDLE_MS) {
        idleTimer = 0;
        stop();
      } else {
        idleTimer = window.setTimeout(checkIdle, SIDEBAR_IDLE_MS - idleFor);
      }
    }

    function noteActivity() {
      lastActivity = performance.now();
      if (!idleTimer) {
        idleTimer = window.setTimeout(checkIdle, SIDEBAR_IDLE_MS);
      }
      start();
    }

    // A still frame (reduced motion, or stopped) is drawn again only when it changes.
    function redrawStill() {
      if (!running) {
        renderFrame(lastDraw);
      }
    }

    updateSize();
    updateColor();
    lastDraw = animate ? performance.now() : 0;
    renderFrame(lastDraw);
    const activityEvents = ["pointermove", "pointerdown", "keydown", "wheel"];
    if (animate) {
      noteActivity();
      activityEvents.forEach((name) => window.addEventListener(name, noteActivity, { passive: true }));
      window.addEventListener("focus", noteActivity);
      window.addEventListener("blur", stop);
    }

    const themeObserver = new MutationObserver(() => {
      updateColor();
      redrawStill();
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class", "data-theme", "style"],
      attributes: true,
    });
    const onResize = () => {
      updateSize();
      // Hidden in the narrow layout: stop. Shown again while the app is in use: go on.
      if (!width || !height) {
        stop();
      } else if (idleTimer) {
        start();
      }
      redrawStill();
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    if (resizeObserver) {
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", onResize);
    }
    return () => {
      stop();
      window.clearTimeout(idleTimer);
      activityEvents.forEach((name) => window.removeEventListener(name, noteActivity));
      window.removeEventListener("focus", noteActivity);
      window.removeEventListener("blur", stop);
      themeObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas aria-hidden="true" className="sidebar-ascii-play" ref={canvasRef} />;
}
