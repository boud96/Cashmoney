import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPatch } from "./api.js";
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
  normalizeHexColor,
  pages,
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
  const filterSelectionsInitialized = useRef(false);
  const confirmationResolver = useRef(null);
  const dashboardLoadSequence = useRef(0);
  const dashboardSummarySequence = useRef(0);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(notify.timeout);
    notify.timeout = window.setTimeout(() => setToast(""), 2600);
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
    setRefs(nextRefs);
    if (!filterSelectionsInitialized.current) {
      filterSelectionsInitialized.current = true;
      setFilters((current) => ({
        ...current,
        ...initialChecklistFilters(nextRefs),
      }));
    }
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
    const loadSequence = dashboardLoadSequence.current + 1;
    const summarySequence = dashboardSummarySequence.current + 1;
    dashboardLoadSequence.current = loadSequence;
    dashboardSummarySequence.current = summarySequence;
    await runDashboardLoad(params, loadSequence, summarySequence);
  }, [filterParams, runDashboardLoad]);

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
    if (filterDefaults.to || filterDefaults.from) {
      const loadSequence = dashboardLoadSequence.current + 1;
      const summarySequence = dashboardSummarySequence.current + 1;
      dashboardLoadSequence.current = loadSequence;
      dashboardSummarySequence.current = summarySequence;
      const timeoutId = window.setTimeout(() => {
        runDashboardLoad(filterParams, loadSequence, summarySequence);
      }, 250);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [filterDefaults.from, filterDefaults.to, filterParams, runDashboardLoad]);

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

        <PageErrorBoundary key={activePage}>
          {activePage === "dashboard" && (
            <DashboardPage
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
              updateTransaction={updateTransaction}
              filterParams={filterParams}
              confirmAction={confirmAction}
              notify={notify}
              reloadDashboard={loadDashboard}
            />
          )}
          <Suspense fallback={<PageFallback />}>
            {activePage === "import" && (
              <ImportPage hideAmounts={hideAmounts} importReport={importReport} notify={notify} refs={refs} reloadAll={loadAll} reloadDashboard={loadDashboard} setImportReport={setImportReport} />
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
      <div className={`toast ${toast ? "is-visible" : ""}`}>{toast}</div>
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
    if (this.state.error) {
      return (
        <section className="panel page-error-panel">
          <div>
            <h2>Page failed to render</h2>
            <p>{this.state.error.message || "An unexpected frontend error occurred."}</p>
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
