import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPatch } from "./api.js";
import { Spinner } from "./components.jsx";
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

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [theme, setTheme] = useState(getStoredTheme);
  const [accent, setAccent] = useState(getStoredAccent);
  const [hideAmounts, setHideAmounts] = useState(getStoredHideAmounts);
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false);
  const [draftAccent, setDraftAccent] = useState("");
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
  const [importReport, setImportReport] = useState(null);
  const [maintenanceSummary, setMaintenanceSummary] = useState(null);
  const [mappingDraft, setMappingDraft] = useState({
    column_map: {},
    categorization_fields: defaultCategorizationFields,
    available_headers: [],
    detected: null,
  });
  const filterSelectionsInitialized = useRef(false);

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

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true);
    try {
      const [nextSummary, nextTransactions] = await Promise.all([
        apiGet("/dashboard/summary/", filterParams),
        apiGet("/transactions/", { ...filterParams, limit: 10000 }),
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
    setDraftAccent(accent || defaultAccentForTheme(theme));
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsAccentPickerOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [accent, isAccentPickerOpen, theme]);

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
              importBusy={loadingDashboard}
              onToggleHideAmounts={toggleHideAmounts}
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
          <Suspense fallback={<PageFallback />}>
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
          </Suspense>
        </PageErrorBoundary>
      </main>
      {isAccentPickerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setIsAccentPickerOpen(false)} role="presentation">
          <div aria-labelledby="accent-modal-title" aria-modal="true" className="accent-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div className="accent-modal-header">
              <h2 id="accent-modal-title">Accent</h2>
              <button className="icon-button" onClick={() => setIsAccentPickerOpen(false)} type="button" aria-label="Close accent picker">x</button>
            </div>
            <label className="accent-custom-picker">
              <span>Custom color</span>
              <input
                onChange={(event) => setDraftAccent(event.target.value)}
                type="color"
                value={draftAccent || accent || defaultAccentForTheme(theme)}
              />
            </label>
            <button className="primary-action accent-confirm-button" onClick={() => updateAccent(draftAccent || defaultAccentForTheme(theme))} type="button">
              Apply custom color
            </button>
            <div className="accent-preset-label">Presets</div>
            <div className="accent-preset-grid">
              {accentPresets.map((color) => {
                const isSelected = normalizeHexColor(accent || defaultAccentForTheme(theme)).toLowerCase() === color.toLowerCase();
                return (
                  <button
                    aria-label={`Use accent ${color}`}
                    aria-pressed={isSelected}
                    className={`accent-preset ${isSelected ? "is-selected" : ""}`}
                    key={color}
                    onClick={() => updateAccent(color)}
                    title={color}
                    style={{ "--preset-color": color }}
                    type="button"
                  >
                    <span className="accent-preset-swatch" />
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
