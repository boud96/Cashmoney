import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  DateFilterModule,
  LocaleModule,
  ModuleRegistry,
  NumberFilterModule,
  QuickFilterModule,
  RowApiModule,
  TextFilterModule,
  themeQuartz,
  TooltipModule,
} from "ag-grid-community";

import { apiDelete, apiFetch, apiGet, apiPatch, apiPost, readJson } from "../api.js";
import { CloseButton, DotLabel, HelpTooltip, LoadingButton, ModalEscape, Select, Tabs, TagToggleList, tabPanelProps, useFillHeight } from "../components.jsx";
import { PencilIcon, TrashIcon } from "../icons.jsx";
import {
  DEFINITIONS_TAB_STORAGE_KEY,
  MAX_IMPORT_FILE_BYTES,
  categorizationFieldOptions,
  coerceArray,
  defaultCategorizationFields,
  defaultParsingSettings,
  definitionHelp,
  fieldLabel,
  fileTooLargeMessage,
  findDuplicate,
  findDuplicateSubcategory,
  formatCount,
  formObject,
  guessColumnMap,
  isStatementFileFormat,
  lines,
  mappedColumnOptions,
  mappingFields,
  mappingFileFormatLabel,
  mappingFileFormats,
  normalizeHexColor,
  parsingSettingsFromMapping,
  pluralize,
  readStoredChoice,
  sanitizeColumnMap,
  storeChoice,
  subLabel,
  titleCase,
  validateRequiredColumnMap,
  validateRequiredFields,
  wniOptions,
} from "../shared.js";

// Only the grid features this page uses (CR-30). A missing module can fail silently,
// so after changing a grid, register ValidationModule while checking it: it names
// every option whose module is missing.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CellStyleModule,  // cellClass
  TooltipModule,  // tooltipField
  QuickFilterModule,  // quickFilterText: each tab's search box
  LocaleModule,  // localeText: "No matches"
  RowApiModule,  // getDisplayedRowCount, to show "No matches"
  TextFilterModule,  // filter: true picks the filter by data type
  NumberFilterModule,
  DateFilterModule,
]);

const definitionGridTheme = themeQuartz
  .withParams({ cellHorizontalPaddingScale: 0.7, fontSize: 13, headerFontSize: 12.5 })
  .withParams({
    accentColor: "var(--action)",
    backgroundColor: "var(--surface)",
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
    backgroundColor: "var(--surface)",
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

// In setup order: an account needs a mapping, keywords need subcategories and tags.
const DEFINITION_TABS = [
  ["accounts", "Accounts"],
  ["mappings", "Import mappings"],
  ["categories", "Categories"],
  ["subcategories", "Subcategories"],
  ["tags", "Tags"],
  ["keywords", "Keywords"],
  ["settings", "App settings"],
];

const defaultCurrencyOptions = [
  { code: "CZK", name: "Czech Koruna" },
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "United States Dollar" },
  { code: "GBP", name: "British Pound" },
];

export default function DefinitionsPage({ confirmAction, mappingDraft, notify, refs, reloadAll, reloadDashboard, setMappingDraft }) {
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

  const [tab, setTab] = useState(() => readStoredChoice(DEFINITIONS_TAB_STORAGE_KEY, DEFINITION_TABS.map(([id]) => id), "accounts"));
  const counts = {
    accounts: refs.accounts.length,
    mappings: refs.mappings.length,
    categories: refs.categories.length,
    subcategories: refs.subcategories.length,
    tags: refs.tags.length,
    keywords: refs.keywords.length,
  };
  const sectionProps = { confirmAction, notify, refs, reloadAll };

  function changeTab(id) {
    setTab(id);
    storeChoice(DEFINITIONS_TAB_STORAGE_KEY, id);
  }

  return (
    <div className="definitions-page">
      <Tabs
        idPrefix="definitions"
        label="Definitions"
        onChange={changeTab}
        tabs={DEFINITION_TABS.map(([id, label]) => ({ badge: id in counts ? formatCount(counts[id]) : "", id, label }))}
        value={tab}
      />
      <div className="definitions-tab-panel" {...tabPanelProps("definitions", tab)}>
        {tab === "accounts" && (
          <DefinitionSection {...sectionProps} endpoint="/bank-accounts/" helpText={definitionHelp["Bank Accounts"]} items={refs.accounts} listRenderer={BankAccountDefinitionGrid} onDeleted={() => clearEditing("/bank-accounts/")} onEdit={(item) => editItem("/bank-accounts/", item)} subtitle="Accounts available for imports" title="Accounts">
            <AccountForm clearEditing={() => clearEditing("/bank-accounts/")} editingItem={editingItems["/bank-accounts/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
          </DefinitionSection>
        )}
        {tab === "mappings" && (
          <DefinitionSection {...sectionProps} endpoint="/csv-mappings/" helpText={definitionHelp["Import Mappings"]} items={refs.mappings} listRenderer={CsvMappingDefinitionGrid} onDeleted={() => clearEditing("/csv-mappings/")} onEdit={(item) => editItem("/csv-mappings/", item)} subtitle="How bank files are read (CSV or camt.053)" title="Import mappings">
            <MappingForm clearEditing={() => clearEditing("/csv-mappings/")} draft={mappingDraft} editingItem={editingItems["/csv-mappings/"]} notify={notify} refs={refs} reloadAll={reloadAll} setDraft={setMappingDraft} />
          </DefinitionSection>
        )}
        {tab === "categories" && (
          <DefinitionSection {...sectionProps} endpoint="/categories/" helpText={definitionHelp.Categories} items={refs.categories} listRenderer={CategoryDefinitionGrid} onDeleted={() => clearEditing("/categories/")} onEdit={(item) => editItem("/categories/", item)} subtitle="Top-level reporting buckets" title="Categories">
            <SimpleForm clearEditing={() => clearEditing("/categories/")} editingItem={editingItems["/categories/"]} endpoint="/categories/" entityLabel="Category" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.categories} notify={notify} reloadAll={reloadAll} />
          </DefinitionSection>
        )}
        {tab === "subcategories" && (
          <DefinitionSection {...sectionProps} endpoint="/subcategories/" helpText={definitionHelp.Subcategories} items={refs.subcategories} listRenderer={SubcategoryDefinitionGrid} onDeleted={() => clearEditing("/subcategories/")} onEdit={(item) => editItem("/subcategories/", item)} subtitle="Assignable category detail" title="Subcategories">
            <SubcategoryForm clearEditing={() => clearEditing("/subcategories/")} editingItem={editingItems["/subcategories/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
          </DefinitionSection>
        )}
        {tab === "tags" && (
          <DefinitionSection {...sectionProps} endpoint="/tags/" helpText={definitionHelp.Tags} items={refs.tags} listRenderer={TagDefinitionGrid} onDeleted={() => clearEditing("/tags/")} onEdit={(item) => editItem("/tags/", item)} subtitle="Flexible transaction labels" title="Tags">
            <SimpleForm clearEditing={() => clearEditing("/tags/")} editingItem={editingItems["/tags/"]} endpoint="/tags/" entityLabel="Tag" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.tags} notify={notify} reloadAll={reloadAll} />
          </DefinitionSection>
        )}
        {tab === "keywords" && (
          <DefinitionSection {...sectionProps} endpoint="/keywords/" helpText={definitionHelp.Keywords} items={refs.keywords} listRenderer={KeywordDefinitionGrid} onDeleted={() => clearEditing("/keywords/")} onEdit={(item) => editItem("/keywords/", item)} subtitle="Rules that categorize transactions by their bank text" title="Keywords">
            <KeywordForm clearEditing={() => clearEditing("/keywords/")} editingItem={editingItems["/keywords/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
          </DefinitionSection>
        )}
        {tab === "settings" && (
          <section className="definition-section">
            <div className="definition-section-header">
              <div className="definition-section-title">
                <h2>App settings</h2>
                <p>Currency, exchange rates, and transfer automation</p>
              </div>
            </div>
            <SettingsForm notify={notify} refs={refs} reloadAll={reloadAll} reloadDashboard={reloadDashboard} settings={refs.settings} />
          </section>
        )}
      </div>
    </div>
  );
}

function SettingsForm({ notify, refs, reloadAll, reloadDashboard, settings }) {
  const [saving, setSaving] = useState(false);
  const [syncingRates, setSyncingRates] = useState(false);
  const [rateStatus, setRateStatus] = useState(null);
  const [currencyOptions, setCurrencyOptions] = useState(defaultCurrencyOptions);
  const [currencyOptionsFallback, setCurrencyOptionsFallback] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState(settings?.default_currency || "CZK");
  const [ignoreInternalAccounts, setIgnoreInternalAccounts] = useState(
    settings?.ignore_internal_account_references ?? true,
  );
  const [internalTransferSubcategoryId, setInternalTransferSubcategoryId] = useState(
    settings?.internal_transfer_subcategory?.id || "",
  );
  const missingRateCount = Number(rateStatus?.missing_converted_transactions || 0);

  useEffect(() => {
    const nextCurrency = settings?.default_currency || "CZK";
    setDefaultCurrency(nextCurrency);
    setCurrencyOptions((current) => ensureCurrencyOption(current, nextCurrency));
    setIgnoreInternalAccounts(settings?.ignore_internal_account_references ?? true);
    setInternalTransferSubcategoryId(settings?.internal_transfer_subcategory?.id || "");
  }, [settings]);

  async function loadRateStatus() {
    try {
      setRateStatus(await apiGet("/exchange-rates/status/"));
    } catch (error) {
      notify(error.message);
    }
  }

  useEffect(() => {
    loadRateStatus();
    loadCurrencyOptions();
  }, []);

  async function loadCurrencyOptions() {
    try {
      const payload = await apiGet("/exchange-rates/currencies/");
      const currentCode = normalizeCurrencyCode(settings?.default_currency || defaultCurrency || "CZK");
      const options = payload.currencies || [];
      setCurrencyOptions(ensureCurrencyOption(options, currentCode));
      setCurrencyOptionsFallback(Boolean(payload.fallback));
    } catch (error) {
      notify(error.message);
    }
  }

  async function refreshAfterCurrencyChange() {
    await Promise.all([
      reloadAll(),
      reloadDashboard ? reloadDashboard() : Promise.resolve(),
      loadRateStatus(),
    ]);
  }

  async function syncExchangeRates(showNotification = true) {
    setSyncingRates(true);
    try {
      const result = await apiPost("/exchange-rates/sync/");
      if (showNotification) {
        notify(`${pluralize(result.created_rates, "rate")} downloaded, ${pluralize(result.recalculation?.updated, "transaction")} recalculated`);
      }
      await refreshAfterCurrencyChange();
      return result;
    } finally {
      setSyncingRates(false);
    }
  }

  async function handleSyncExchangeRates() {
    try {
      await syncExchangeRates();
    } catch (error) {
      notify(error.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const nextDefaultCurrency = normalizeCurrencyCode(defaultCurrency);
    if (nextDefaultCurrency.length !== 3) {
      notify("Default currency must be a three-letter code");
      return;
    }
    const previousDefaultCurrency = settings?.default_currency || "CZK";
    setSaving(true);
    try {
      await apiPatch("/settings/", {
        default_currency: nextDefaultCurrency,
        ignore_internal_account_references: ignoreInternalAccounts,
        internal_transfer_subcategory_id: internalTransferSubcategoryId,
      });
      if (nextDefaultCurrency !== previousDefaultCurrency) {
        try {
          const result = await syncExchangeRates(false);
          notify(`${pluralize(result.created_rates, "rate")} downloaded, default currency changed to ${nextDefaultCurrency}`);
        } catch (error) {
          notify(`Settings saved, but rate sync failed: ${error.message}`);
          await refreshAfterCurrencyChange();
        }
      } else {
        notify("Settings saved");
        await refreshAfterCurrencyChange();
      }
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compact-form app-settings-form" onSubmit={submit}>
      <FormField label="Default currency">
        <Select
          name="default_currency"
          onChange={(event) => setDefaultCurrency(normalizeCurrencyCode(event.target.value))}
          options={currencyOptions.map((currency) => [
            currency.code,
            `${currency.code} - ${currency.name}`,
          ])}
          required
          value={defaultCurrency}
        />
      </FormField>
      <label className="check-row">
        <input
          checked={ignoreInternalAccounts}
          onChange={(event) => setIgnoreInternalAccounts(event.target.checked)}
          type="checkbox"
        />
        <span>Set transactions as ignored that mention another configured bank account automatically</span>
      </label>
      <FormField label="Internal transfer subcategory">
        <Select
          blank="No automatic subcategory"
          name="internal_transfer_subcategory_id"
          onChange={(event) => setInternalTransferSubcategoryId(event.target.value)}
          options={refs.subcategories.map((item) => [item.id, subLabel(item)])}
          value={internalTransferSubcategoryId}
        />
      </FormField>
      <LoadingButton busy={saving} busyLabel="Saving" className="primary-action app-settings-action" type="submit">Save</LoadingButton>
      {missingRateCount ? (
        <LoadingButton busy={syncingRates} busyLabel="Retrying" className="primary-action app-settings-action" onClick={handleSyncExchangeRates} type="button">
          Retry Rate Sync
        </LoadingButton>
      ) : null}
      <div className="exchange-rate-status">
        <span>FX cache</span>
        <strong>{formatExchangeRateStatus(rateStatus)}</strong>
        {missingRateCount ? (
          <span className="warning-text">
            {pluralize(missingRateCount, "transaction")} {missingRateCount === 1 ? "needs" : "need"} rates
          </span>
        ) : currencyOptionsFallback ? (
          <span className="warning-text">Currency list is using fallback options.</span>
        ) : (
          <span className="muted">Rates sync automatically after imports and default currency changes.</span>
        )}
      </div>
    </form>
  );
}

function normalizeCurrencyCode(value) {
  return String(value || "").replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3);
}

function ensureCurrencyOption(options, code) {
  const normalizedCode = normalizeCurrencyCode(code || "CZK");
  const normalizedOptions = (options || []).map((option) => ({
    code: normalizeCurrencyCode(option.code),
    name: option.name || option.code,
  })).filter((option) => option.code);
  if (normalizedOptions.some((option) => option.code === normalizedCode)) {
    return normalizedOptions;
  }
  return [{ code: normalizedCode, name: normalizedCode }, ...normalizedOptions];
}

function formatExchangeRateStatus(status) {
  if (!status) {
    return "Loading";
  }
  const count = formatCount(status.cached_rate_count);
  if (!status.latest_cached_rate_date) {
    return `${count} cached rates`;
  }
  return `${count} cached rates through ${status.latest_cached_rate_date}`;
}

// One tab: title, count and description, a search box for its table, the form's "+ Add"
// button (the form renders its own button and dialog) and help, then the table.
function DefinitionSection({ children, confirmAction, endpoint, helpText, items, listRenderer: ListRenderer, notify, onDeleted, onEdit, refs, reloadAll, subtitle, title }) {
  const [search, setSearch] = useState("");
  return (
    <section className="definition-section">
      <div className="definition-section-header">
        <div className="definition-section-title">
          <h2>{title} <span className="definition-section-count">{formatCount(items.length)}</span></h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {/* One group, so a narrow window wraps it under the title as a whole. */}
        <div className="definition-section-tools">
          <input
            aria-label={`Search ${title.toLowerCase()}`}
            className="definition-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${title.toLowerCase()}`}
            type="search"
            value={search}
          />
          {children}
          {helpText && <HelpTooltip text={helpText} />}
        </div>
      </div>
      <ListRenderer confirmAction={confirmAction} endpoint={endpoint} items={items} notify={notify} onDeleted={onDeleted} onEdit={onEdit} quickFilterText={search} refs={refs} reloadAll={reloadAll} />
    </section>
  );
}

// The grids' action cells call the latest callbacks through this ref. The page passes
// new callback functions on every render; had the column definitions depended on them,
// every App render (a dialog, a toast) rebuilt the cells and dropped keyboard focus.
function useDefinitionActions(callbacks) {
  const actions = useRef(callbacks);
  useLayoutEffect(() => {
    actions.current = callbacks;
  });
  return actions;
}

function definitionActionColumn({ actions, endpoint, nameGetter = (item) => item.name }) {
  return {
    cellClass: "definition-grid-actions-cell",
    cellRenderer: (params) => (
      <div className="definition-grid-actions">
        <button
          aria-label={`Edit ${nameGetter(params.data)}`}
          className="icon-action"
          onClick={() => actions.current.onEdit(params.data)}
          title={`Edit ${nameGetter(params.data)}`}
          type="button"
        >
          <PencilIcon />
        </button>
        <DeleteButton
          confirmAction={(options) => actions.current.confirmAction(options)}
          endpoint={`${endpoint}${params.data.id}/`}
          iconOnly
          name={nameGetter(params.data)}
          notify={(message) => actions.current.notify?.(message)}
          onDeleted={() => actions.current.onDeleted?.()}
          reloadAll={() => actions.current.reloadAll?.()}
        />
      </div>
    ),
    headerName: "",
    minWidth: 80,
    pinned: "right",
    resizable: false,
    sortable: false,
    width: 80,
  };
}

function DefinitionAgGridList({ className = "", columnDefs, items, quickFilterText = "", rowData }) {
  if (!items.length) {
    return <div className="muted definition-grid-empty">No records yet.</div>;
  }
  return <DefinitionGrid className={className} columnDefs={columnDefs} quickFilterText={quickFilterText} rowData={rowData} />;
}

const definitionGridText = { noRowsToShow: "No matches" };

// The grid shows its no-rows message only for empty data; the search can hide every row too.
function showNoMatches(event) {
  if (event.api.getDisplayedRowCount()) {
    event.api.hideOverlay();
  } else {
    event.api.showNoRowsOverlay();
  }
}

// A component of its own so useFillHeight measures the grid when it mounts, also when a
// tab that started empty gets its first record.
function DefinitionGrid({ className, columnDefs, quickFilterText, rowData }) {
  const gridRef = useRef(null);
  useFillHeight(gridRef, { min: 320 });
  return (
    <div className={`definition-grid-list ${className}`.trim()} ref={gridRef}>
      <AgGridReact
        columnDefs={columnDefs}
        defaultColDef={{ filter: true, resizable: true, sortable: true }}
        enableCellTextSelection
        ensureDomOrder
        headerHeight={34}
        localeText={definitionGridText}
        onModelUpdated={showNoMatches}
        quickFilterText={quickFilterText}
        rowData={rowData}
        rowHeight={34}
        theme={definitionGridTheme}
      />
    </div>
  );
}

function DefinitionGridColorCell({ value }) {
  if (!value) {
    return <span className="definition-grid-color-empty">None</span>;
  }
  return (
    <span className="definition-grid-color">
      <span className="definition-grid-color-swatch" style={{ background: value }} />
      <span>{value}</span>
    </span>
  );
}

function CsvMappingDefinitionGrid({ confirmAction, endpoint, items, notify, onDeleted, onEdit, quickFilterText, reloadAll }) {
  const actions = useDefinitionActions({ confirmAction, notify, onDeleted, onEdit, reloadAll });
  const rowData = useMemo(() => items.map((item) => ({
    ...item,
    categorization_fields_text: (item.categorization_fields || []).map((field) => fieldLabel(field)).join(", "),
    delimiter_text: isStatementFileFormat(item.file_format) ? "" : item.delimiter === "\t" ? "\\t" : item.delimiter,
    file_format_text: mappingFileFormatLabel(item.file_format),
  })), [items]);
  const columnDefs = useMemo(() => [
    { field: "name", flex: 1.2, headerName: "Name", minWidth: 150 },
    { field: "file_format_text", headerName: "Format", minWidth: 110, width: 120 },
    { field: "default_currency", headerName: "Currency", minWidth: 84, width: 92 },
    { field: "delimiter_text", headerName: "Delimiter", minWidth: 84, width: 92 },
    { field: "date_format", headerName: "Date format", minWidth: 104, width: 112 },
    { field: "encoding", headerName: "Encoding", minWidth: 96, width: 100 },
    { field: "header_row", headerName: "Header row", minWidth: 92, width: 100 },
    { field: "categorization_fields_text", flex: 1.4, headerName: "Categorization fields", minWidth: 150, tooltipField: "categorization_fields_text" },
    definitionActionColumn({ actions, endpoint }),
  ], [actions, endpoint]);

  return <DefinitionAgGridList className="csv-mapping-definition-grid" columnDefs={columnDefs} items={items} quickFilterText={quickFilterText} rowData={rowData} />;
}

function BankAccountDefinitionGrid({ confirmAction, endpoint, items, notify, onDeleted, onEdit, quickFilterText, reloadAll }) {
  const actions = useDefinitionActions({ confirmAction, notify, onDeleted, onEdit, reloadAll });
  const rowData = useMemo(() => items.map((item) => ({
    ...item,
    default_mapping_text: item.default_csv_mapping?.name || "No default mapping",
  })), [items]);
  const columnDefs = useMemo(() => [
    { field: "name", flex: 1.1, headerName: "Name", minWidth: 140 },
    { field: "bank_name", flex: 1, headerName: "Bank", minWidth: 120 },
    { field: "currency", headerName: "Currency", minWidth: 84, width: 92 },
    { field: "owners", headerName: "Owners", minWidth: 76, width: 84 },
    { field: "account_number", flex: 1, headerName: "Account number", minWidth: 140 },
    { field: "default_mapping_text", flex: 1.2, headerName: "Default mapping", minWidth: 150, tooltipField: "default_mapping_text" },
    definitionActionColumn({ actions, endpoint }),
  ], [actions, endpoint]);

  return <DefinitionAgGridList className="bank-account-definition-grid" columnDefs={columnDefs} items={items} quickFilterText={quickFilterText} rowData={rowData} />;
}

function CategoryDefinitionGrid({ confirmAction, endpoint, items, notify, onDeleted, onEdit, quickFilterText, reloadAll }) {
  const actions = useDefinitionActions({ confirmAction, notify, onDeleted, onEdit, reloadAll });
  const columnDefs = useMemo(() => [
    { cellRenderer: DefinitionGridColorCell, field: "color", filter: false, headerName: "Color", minWidth: 100, width: 110 },
    { field: "name", flex: 1, headerName: "Name", minWidth: 150 },
    { field: "description", flex: 1.6, headerName: "Description", minWidth: 200, tooltipField: "description" },
    definitionActionColumn({ actions, endpoint }),
  ], [actions, endpoint]);

  return <DefinitionAgGridList className="category-definition-grid" columnDefs={columnDefs} items={items} quickFilterText={quickFilterText} rowData={items} />;
}

function SubcategoryDefinitionGrid({ confirmAction, endpoint, items, notify, onDeleted, onEdit, quickFilterText, reloadAll }) {
  const actions = useDefinitionActions({ confirmAction, notify, onDeleted, onEdit, reloadAll });
  const rowData = useMemo(() => items.map((item) => ({
    ...item,
    category_text: item.category?.name || "No category",
  })), [items]);
  const columnDefs = useMemo(() => [
    { cellRenderer: DefinitionGridColorCell, field: "color", filter: false, headerName: "Color", minWidth: 100, width: 110 },
    { field: "name", flex: 1, headerName: "Name", minWidth: 150 },
    { field: "category_text", flex: 1, headerName: "Category", minWidth: 150 },
    { field: "description", flex: 1.4, headerName: "Description", minWidth: 200, tooltipField: "description" },
    definitionActionColumn({ actions, endpoint }),
  ], [actions, endpoint]);

  return <DefinitionAgGridList className="subcategory-definition-grid" columnDefs={columnDefs} items={items} quickFilterText={quickFilterText} rowData={rowData} />;
}

function TagDefinitionGrid({ confirmAction, endpoint, items, notify, onDeleted, onEdit, quickFilterText, reloadAll }) {
  const actions = useDefinitionActions({ confirmAction, notify, onDeleted, onEdit, reloadAll });
  const columnDefs = useMemo(() => [
    { cellRenderer: DefinitionGridColorCell, field: "color", filter: false, headerName: "Color", minWidth: 100, width: 110 },
    { field: "name", flex: 1, headerName: "Name", minWidth: 150 },
    { field: "description", flex: 1.6, headerName: "Description", minWidth: 200, tooltipField: "description" },
    definitionActionColumn({ actions, endpoint }),
  ], [actions, endpoint]);

  return <DefinitionAgGridList className="tag-definition-grid" columnDefs={columnDefs} items={items} quickFilterText={quickFilterText} rowData={items} />;
}

function KeywordDefinitionGrid({ confirmAction, endpoint, items, notify, onDeleted, onEdit, quickFilterText, refs, reloadAll }) {
  const actions = useDefinitionActions({ confirmAction, notify, onDeleted, onEdit, reloadAll });
  const rowData = useMemo(() => {
    const subcategories = new Map(refs.subcategories.map((item) => [item.id, item]));
    const categories = new Map(refs.categories.map((item) => [item.id, item]));
    return items.map((item) => {
      const subcategory = subcategories.get(item.subcategory?.id);
      const category = categories.get(subcategory?.category?.id);
      return {
        ...item,
        include_terms_text: (item.include_terms || []).join(", "),
        exclude_terms_text: (item.exclude_terms || []).join(", "),
        subcategory_color: category?.color || "",
        subcategory_text: subcategory
          ? `${subcategory.category?.name || "No category"} › ${subcategory.name}`
          : item.subcategory?.name || "No subcategory",
        tags_text: (item.tags || []).map((tag) => tag.name).join(", "),
        wni_text: item.want_need_investment ? titleCase(item.want_need_investment) : "No WNI",
      };
    });
  }, [items, refs.categories, refs.subcategories]);
  const columnDefs = useMemo(() => [
    {
      field: "name",
      flex: 1.2,
      headerName: "Name",
      minWidth: 140,
    },
    {
      field: "include_terms_text",
      flex: 1.6,
      headerName: "Include",
      minWidth: 150,
      tooltipField: "include_terms_text",
    },
    {
      field: "exclude_terms_text",
      flex: 1,
      headerName: "Exclude",
      minWidth: 100,
      tooltipField: "exclude_terms_text",
    },
    {
      cellRenderer: (params) => (params.data.subcategory_color ? <DotLabel color={params.data.subcategory_color} label={params.value} /> : params.value),
      field: "subcategory_text",
      headerName: "Subcategory",
      minWidth: 170,
      tooltipField: "subcategory_text",
      width: 200,
    },
    {
      field: "wni_text",
      headerName: "WNI",
      minWidth: 88,
      width: 96,
    },
    {
      field: "tags_text",
      flex: 1,
      headerName: "Tags",
      minWidth: 100,
      tooltipField: "tags_text",
    },
    {
      field: "priority",
      headerName: "Priority",
      minWidth: 88,
      width: 92,
    },
    {
      field: "is_ignored",
      headerName: "Ignored",
      minWidth: 88,
      valueFormatter: (params) => (params.value ? "Yes" : "No"),
      width: 92,
    },
    definitionActionColumn({ actions, endpoint }),
  ], [actions, endpoint]);

  return <DefinitionAgGridList className="keyword-definition-grid" columnDefs={columnDefs} items={items} quickFilterText={quickFilterText} rowData={rowData} />;
}

function DeleteButton({ confirmAction, endpoint, iconOnly = false, name, notify, onDeleted, reloadAll }) {
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    let impact;
    setDeleting(true);
    try {
      impact = await apiGet(`${endpoint}delete-impact/`);
    } catch (error) {
      notify?.(error.message);
      return;
    } finally {
      setDeleting(false);
    }
    if (impact.blocked) {
      notify?.(impact.blocked);
      return;
    }
    const effects = impact.effects || [];
    const confirmed = await confirmAction({
      confirmLabel: "Delete",
      danger: true,
      message: effects.length ? `Delete ${name}?\n\n${effects.join("\n")}` : `Delete ${name}?`,
      title: "Delete record",
    });
    if (!confirmed) {
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
  if (iconOnly) {
    return (
      <LoadingButton aria-label={`Delete ${name}`} busy={deleting} busyLabel="" className="icon-action icon-action-danger" onClick={remove} title={`Delete ${name}`} type="button">
        <TrashIcon size={16} />
      </LoadingButton>
    );
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

function AccountForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setIsAdding(false);
    }
  }, [editingItem]);

  function openAddAccount() {
    clearEditing?.();
    setIsAdding(true);
  }

  function closeAccountModal() {
    if (saving) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    if (!validateRequiredFields(form, ["name", "currency", "owners"], notify)) {
      return;
    }
    if (data.account_number) {
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
      setIsAdding(false);
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
    <>
      <div className="definition-panel-actions">
        <button className="link-button" onClick={openAddAccount} type="button">+ Add account</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeAccountModal()} role="presentation">
          <ModalEscape onClose={closeAccountModal} />
          <form aria-labelledby="account-modal-title" aria-modal="true" className="definition-modal" key={editingItem?.id || "new-account"} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id="account-modal-title">{isEditing ? "Edit bank account" : "Add bank account"}</h3>
                <span>{editingItem?.name || "New bank account"}</span>
              </div>
              <CloseButton disabled={saving} onClick={closeAccountModal} />
            </div>
            <div className="definition-modal-body">
              <div className="compact-form">
                <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Account name" required /></FormField>
                <FormField label="Account number"><input defaultValue={editingItem?.account_number || ""} name="account_number" placeholder="Optional account number" /></FormField>
                <FormField label="Bank"><input defaultValue={editingItem?.bank_name || ""} name="bank_name" placeholder="Bank name" /></FormField>
                <FormField label="Currency"><input defaultValue={editingItem?.currency || "CZK"} maxLength="3" name="currency" pattern="[A-Za-z]{3}" placeholder="CZK" required title="Three-letter currency code, e.g. CZK or EUR" /></FormField>
                <FormField label="Owners"><input defaultValue={editingItem?.owners || "1"} min="1" name="owners" required type="number" /></FormField>
                <FormField label="Default import mapping"><Select blank="No default mapping" defaultValue={editingItem?.default_csv_mapping?.id || ""} name="default_csv_mapping_id" options={refs.mappings.map((item) => [item.id, item.name])} /></FormField>
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button modal-action-cancel" disabled={saving} onClick={closeAccountModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" type="submit">
                {isEditing ? "Save account" : "Create account"}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

const mappingWizardSteps = ["Source", "Parsing", "Columns", "Confirm"];

function MappingForm({ clearEditing, draft, editingItem, notify, refs, reloadAll, setDraft }) {
  const [isAdding, setIsAdding] = useState(false);
  const [step, setStep] = useState(0);
  const [mappingDetails, setMappingDetails] = useState({ name: "", default_currency: "CZK", file_format: "csv" });
  const [sampleFile, setSampleFile] = useState(null);
  const formRef = useRef(null);
  const sampleFileRef = useRef(null);
  const headers = useMemo(
    () => mappedColumnOptions(draft.detected?.headers || draft.available_headers || [], draft.column_map),
    [draft.detected?.headers, draft.available_headers, draft.column_map],
  );
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const isStatementFormat = isStatementFileFormat(mappingDetails.file_format);
  const currentStep = Math.min(step, mappingWizardSteps.length - 1);
  const [parsingSettings, setParsingSettings] = useState(() => parsingSettingsFromMapping(editingItem));
  const [manualParsingSettings, setManualParsingSettings] = useState(Boolean(editingItem));
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingItem) {
      if (!isAdding) {
        resetWizardState();
      }
      return;
    }
    setIsAdding(false);
    setStep(0);
    setMappingDetails({
      name: editingItem.name || "",
      default_currency: normalizeCurrencyCode(editingItem.default_currency || "CZK"),
      file_format: editingItem.file_format || "csv",
    });
    setParsingSettings(parsingSettingsFromMapping(editingItem));
    setManualParsingSettings(true);
    setDraft({
      column_map: sanitizeColumnMap(editingItem.column_map || {}),
      categorization_fields: editingItem.categorization_fields?.length ? editingItem.categorization_fields : defaultCategorizationFields,
      available_headers: editingItem.available_headers || [],
      detected: null,
    });
  }, [editingItem, isAdding, setDraft]);

  function resetWizardState() {
    setStep(0);
    setMappingDetails({ name: "", default_currency: "CZK", file_format: "csv" });
    setSampleFile(null);
    setParsingSettings(defaultParsingSettings);
    setManualParsingSettings(false);
    setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, available_headers: [], detected: null });
    if (sampleFileRef.current) {
      sampleFileRef.current.value = "";
    }
  }

  function openAddWizard() {
    clearEditing?.();
    resetWizardState();
    setIsAdding(true);
  }

  function closeWizard() {
    if (saving || detecting) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
    resetWizardState();
  }

  function updateMappingDetail(field, value) {
    setMappingDetails((current) => ({
      ...current,
      [field]: field === "default_currency" ? normalizeCurrencyCode(value) : value,
    }));
  }

  function updateParsingSetting(field, value) {
    setParsingSettings((current) => ({ ...current, [field]: value }));
    setManualParsingSettings(true);
  }

  async function detectColumns(event) {
    event.preventDefault();
    const file = sampleFileRef.current?.files?.[0] || sampleFile;
    if (!file) {
      notify("Choose a sample CSV");
      return;
    }
    const tooLarge = fileTooLargeMessage(file, MAX_IMPORT_FILE_BYTES);
    if (tooLarge) {
      notify(tooLarge);
      return;
    }
    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("default_currency", mappingDetails.default_currency || "CZK");
    if (manualParsingSettings) {
      formData.append("manual_settings", "1");
      Object.entries(parsingSettings).forEach(([field, value]) => {
        formData.append(field, value ?? "");
      });
    }
    formData.append("sample_size", "5");
    setDetecting(true);
    try {
      const response = await apiFetch("/api/csv-mappings/detect-columns/", { method: "POST", body: formData });
      const payload = await readJson(response, "Column detection failed");
      const nextSettings = { ...defaultParsingSettings, ...(payload.detected_settings || {}) };
      setParsingSettings(nextSettings);
      setManualParsingSettings(false);
      setDraft({
        detected: payload,
        column_map: guessColumnMap(payload.headers),
        categorization_fields: defaultCategorizationFields,
        available_headers: payload.headers || [],
      });
      notify(`Detected ${payload.headers.length} columns`);
    } catch (error) {
      notify(error.message);
    } finally {
      setDetecting(false);
    }
  }

  function validateSourceStep() {
    const name = mappingDetails.name.trim();
    const currency = normalizeCurrencyCode(mappingDetails.default_currency);
    if (!name) {
      setStep(0);
      notify("Name is required");
      formRef.current?.elements.name?.focus();
      return false;
    }
    if (currency.length !== 3) {
      setStep(0);
      notify("Default currency must be a 3-letter code");
      formRef.current?.elements.default_currency?.focus();
      return false;
    }
    if (findDuplicate(refs.mappings, "name", name, editingItem?.id)) {
      setStep(0);
      notify("A mapping with this name already exists");
      formRef.current?.elements.name?.focus();
      return false;
    }
    return true;
  }

  function validateParsingStep() {
    if (isStatementFormat) {
      return true;
    }
    const requiredSettings = [
      ["delimiter", "Delimiter"],
      ["quotechar", "Quote character"],
      ["encoding", "Encoding"],
      ["date_format", "Date format"],
      ["decimal_separator", "Decimal separator"],
    ];
    const missing = requiredSettings.find(([field]) => !String(parsingSettings[field] ?? "").trim());
    if (missing) {
      setStep(1);
      notify(`${missing[1]} is required`);
      return false;
    }
    if (!String(parsingSettings.header_row ?? "").trim()) {
      setStep(1);
      notify("Header row is required");
      return false;
    }
    const headerRow = Number(parsingSettings.header_row);
    if (!Number.isInteger(headerRow) || headerRow < 0) {
      setStep(1);
      notify("Header row must be zero or greater");
      return false;
    }
    return true;
  }

  function validateColumnsStep() {
    if (!isStatementFormat && !validateRequiredColumnMap(draft.column_map, notify)) {
      setStep(2);
      return false;
    }
    if (!draft.categorization_fields.length) {
      setStep(2);
      notify("Choose at least one categorization field");
      return false;
    }
    return true;
  }

  function goNext() {
    const validators = [validateSourceStep, validateParsingStep, validateColumnsStep];
    if (validators[currentStep]?.() === false) {
      return;
    }
    setStep((value) => Math.min(value + 1, mappingWizardSteps.length - 1));
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (currentStep < mappingWizardSteps.length - 1) {
      goNext();
      return;
    }
    if (!validateSourceStep() || !validateParsingStep() || !validateColumnsStep()) {
      return;
    }
    const data = {
      name: mappingDetails.name.trim(),
      default_currency: normalizeCurrencyCode(mappingDetails.default_currency),
      file_format: mappingDetails.file_format,
      delimiter: parsingSettings.delimiter,
      quotechar: parsingSettings.quotechar,
      encoding: parsingSettings.encoding,
      header_row: Number(parsingSettings.header_row || 0),
      date_format: parsingSettings.date_format,
      decimal_separator: parsingSettings.decimal_separator,
      thousands_separator: parsingSettings.thousands_separator || "",
      column_map: sanitizeColumnMap(draft.column_map),
      categorization_fields: draft.categorization_fields,
      // The wizard doesn't show extra date formats; keep any the mapping already has.
      fallback_date_formats: editingItem?.fallback_date_formats || [],
    };
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/csv-mappings/${editingItem.id}/`, data);
      } else {
        await apiPost("/csv-mappings/", data);
      }
      form.reset();
      setIsAdding(false);
      clearEditing?.();
      resetWizardState();
      notify(isEditing ? "Import mapping saved" : "Import mapping added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  function renderStepContent() {
    if (currentStep === 0) {
      return (
        <div className="mapping-wizard-step-panel">
          <div className="mapping-wizard-grid">
            <FormField label="Name">
              <input
                name="name"
                onChange={(event) => updateMappingDetail("name", event.target.value)}
                placeholder="Mapping name"
                value={mappingDetails.name}
              />
            </FormField>
            <FormField label="Default currency">
              <input
                maxLength="3"
                name="default_currency"
                onChange={(event) => updateMappingDetail("default_currency", event.target.value)}
                placeholder="CZK"
                value={mappingDetails.default_currency}
              />
            </FormField>
            <FormField label="Format">
              <select name="file_format" onChange={(event) => updateMappingDetail("file_format", event.target.value)} value={mappingDetails.file_format}>
                {mappingFileFormats.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </FormField>
            {isStatementFormat ? null : (
              <label className="mapping-file-field">
                <span>Sample CSV</span>
                <input accept=".csv,text/csv" name="sample_csv" onChange={(event) => setSampleFile(event.target.files?.[0] || null)} ref={sampleFileRef} type="file" />
              </label>
            )}
          </div>
        </div>
      );
    }
    if (currentStep === 1 && isStatementFormat) {
      return (
        <div className="mapping-wizard-step-panel">
          <div className="mapping-empty-state">
            {mappingFileFormatLabel(mappingDetails.file_format)} statements are read directly, so no parsing settings are needed.
          </div>
        </div>
      );
    }
    if (currentStep === 1) {
      return (
        <div className="mapping-wizard-step-panel">
          <div className="advanced-settings-grid mapping-wizard-parsing-grid">
            <FormField label="Delimiter"><input maxLength="1" name="delimiter" onChange={(event) => updateParsingSetting("delimiter", event.target.value)} placeholder="," value={parsingSettings.delimiter} /></FormField>
            <FormField label="Date format"><input name="date_format" onChange={(event) => updateParsingSetting("date_format", event.target.value)} placeholder="%Y-%m-%d" value={parsingSettings.date_format} /></FormField>
            <FormField label="Encoding"><input name="encoding" onChange={(event) => updateParsingSetting("encoding", event.target.value)} placeholder="utf-8-sig" value={parsingSettings.encoding} /></FormField>
            <FormField label="Header row"><input min="0" name="header_row" onChange={(event) => updateParsingSetting("header_row", event.target.value)} placeholder="0" type="number" value={parsingSettings.header_row} /></FormField>
            <FormField label="Quote character"><input maxLength="1" name="quotechar" onChange={(event) => updateParsingSetting("quotechar", event.target.value)} placeholder={'"'} value={parsingSettings.quotechar} /></FormField>
            {/* No thousands-separator field: parsing treats the other mark as the only grouping mark and ignores spaces (CR-59). */}
            <FormField label="Decimal separator"><input maxLength="1" name="decimal_separator" onChange={(event) => updateParsingSetting("decimal_separator", event.target.value)} placeholder="." value={parsingSettings.decimal_separator} /></FormField>
            <div className="mapping-parser-action">
              <LoadingButton busy={detecting} busyLabel="Detecting" className="link-button mapping-detect-button" disabled={saving} onClick={detectColumns} type="button">Detect columns</LoadingButton>
              {draft.detected ? <span className="mapping-detection-status">{draft.detected.headers?.length || 0} columns detected</span> : null}
            </div>
          </div>
        </div>
      );
    }
    if (currentStep === 2) {
      return (
        <div className="mapping-wizard-step-panel">
          {isStatementFormat ? (
            <div className="mapping-empty-state">
              Columns are mapped automatically for {mappingFileFormatLabel(mappingDetails.file_format)} statements.
            </div>
          ) : (
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
          )}
          <DefinitionCheckboxField
            className="mapping-categorization-field"
            label="Categorization fields"
            helpText="Keywords and recategorization build their matching text from these transaction fields. Select every field that can contain useful merchant, counterparty, note, symbol, or transaction-type text."
            onChange={(next) => setDraft((current) => ({ ...current, categorization_fields: next }))}
            options={categorizationFieldOptions}
            placeholder="No categorization fields selected"
            value={draft.categorization_fields}
          />
        </div>
      );
    }
    return (
      <MappingReview
        draft={draft}
        headers={headers}
        isStatementFormat={isStatementFormat}
        mappingDetails={mappingDetails}
        parsingSettings={parsingSettings}
      />
    );
  }

  function renderSamplePreview() {
    if (isStatementFormat) {
      return null;
    }
    return (
      <div className="mapping-wizard-sample">
        {draft.detected?.warnings?.length ? (
          <div className="mapping-warnings">
            {draft.detected.warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        ) : null}
        {draft.detected ? <MappingSample detected={draft.detected} /> : <div className="mapping-empty-state">No sample data detected.</div>}
      </div>
    );
  }

  return (
    <>
      <div className="mapping-panel-actions">
        <button className="link-button" onClick={openAddWizard} type="button">+ Add mapping</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeWizard()} role="presentation">
          <ModalEscape onClose={closeWizard} />
          <form aria-labelledby="mapping-wizard-title" aria-modal="true" className="mapping-wizard-modal" key={editingItem?.id || "new-mapping"} onSubmit={submit} ref={formRef} role="dialog">
            <div className="mapping-wizard-header">
              <div>
                <h3 id="mapping-wizard-title">{isEditing ? "Edit import mapping" : "Add import mapping"}</h3>
                <span>{mappingDetails.name || "New mapping"}</span>
              </div>
              <CloseButton disabled={saving || detecting} onClick={closeWizard} />
            </div>
            <div aria-label="Import mapping steps" className="mapping-wizard-steps">
              {mappingWizardSteps.map((label, index) => (
                <div className={`mapping-wizard-step ${index === currentStep ? "is-active" : ""} ${index < currentStep ? "is-complete" : ""}`.trim()} key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
            <div className="mapping-wizard-body">
              <h4>{mappingWizardSteps[currentStep]}</h4>
              {renderStepContent()}
              {renderSamplePreview()}
            </div>
            <div className="mapping-wizard-actions">
              <button className="link-button modal-action-cancel" disabled={saving || detecting} onClick={closeWizard} type="button">Cancel</button>
              <button className="link-button mapping-back-button" disabled={currentStep === 0 || saving || detecting} onClick={() => setStep((value) => Math.max(value - 1, 0))} type="button">Back</button>
              {currentStep < mappingWizardSteps.length - 1 ? (
                <button className="primary-action" disabled={saving || detecting} onClick={goNext} type="button">Next</button>
              ) : (
                <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" disabled={detecting} type="submit">
                  {isEditing ? "Save mapping" : "Create mapping"}
                </LoadingButton>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function MappingReview({ draft, headers, isStatementFormat, mappingDetails, parsingSettings }) {
  const mappedFields = mappingFields
    .map(([key, label]) => [label, coerceArray(draft.column_map[key]).filter(Boolean).join(", ")])
    .filter(([, value]) => value);
  return (
    <div className="mapping-review">
      <div className="mapping-review-grid">
        <div><span>Name</span><strong>{mappingDetails.name || "Unnamed"}</strong></div>
        <div><span>Default currency</span><strong>{mappingDetails.default_currency || "CZK"}</strong></div>
        <div><span>Format</span><strong>{mappingFileFormatLabel(mappingDetails.file_format)}</strong></div>
        {isStatementFormat ? null : (
          <>
            <div><span>Detected columns</span><strong>{headers.length}</strong></div>
            <div><span>Date format</span><strong>{parsingSettings.date_format}</strong></div>
            <div><span>Delimiter</span><strong>{parsingSettings.delimiter}</strong></div>
            <div><span>Encoding</span><strong>{parsingSettings.encoding}</strong></div>
          </>
        )}
      </div>
      {isStatementFormat ? null : (
      <div className="mapping-review-section">
        <span>Column map</span>
        <div className="mapping-review-list">
          {mappedFields.length ? mappedFields.map(([label, value]) => (
            <div key={label}><strong>{label}</strong><span>{value}</span></div>
          )) : <div className="muted">No columns mapped.</div>}
        </div>
      </div>
      )}
      <div className="mapping-review-section">
        <span>Categorization fields</span>
        <div className="mapping-review-tags">
          {draft.categorization_fields.length ? draft.categorization_fields.map((field) => (
            <span key={field}>{fieldLabel(field)}</span>
          )) : <span className="muted">None selected.</span>}
        </div>
      </div>
    </div>
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

function SimpleForm({ clearEditing, editingItem, endpoint, entityLabel = "Record", fields, items = [], notify, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setIsAdding(false);
    }
  }, [editingItem]);

  function openAddItem() {
    clearEditing?.();
    setIsAdding(true);
  }

  function closeItemModal() {
    if (saving) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
  }

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
      setIsAdding(false);
      clearEditing?.();
      notify(isEditing ? `${entityLabel} saved` : `${entityLabel} added`);
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="definition-panel-actions">
        <button className="link-button" onClick={openAddItem} type="button">+ Add {entityLabel.toLowerCase()}</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeItemModal()} role="presentation">
          <ModalEscape onClose={closeItemModal} />
          <form aria-labelledby={`${endpoint.replace(/\W/g, "")}-modal-title`} aria-modal="true" className="definition-modal" key={editingItem?.id || `${endpoint}-new`} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id={`${endpoint.replace(/\W/g, "")}-modal-title`}>{isEditing ? `Edit ${entityLabel.toLowerCase()}` : `Add ${entityLabel.toLowerCase()}`}</h3>
                <span>{editingItem?.name || `New ${entityLabel.toLowerCase()}`}</span>
              </div>
              <CloseButton disabled={saving} onClick={closeItemModal} />
            </div>
            <div className="definition-modal-body">
              <div className="compact-form">
                {fields.map(([name, placeholder, required]) => (
                  name === "color"
                    ? <ColorInput initialValue={editingItem?.[name] || ""} key={name} label={placeholder} name={name} />
                    : <FormField key={name} label={placeholder}><input defaultValue={editingItem?.[name] || ""} name={name} placeholder={placeholder} required={required} /></FormField>
                ))}
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button modal-action-cancel" disabled={saving} onClick={closeItemModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" type="submit">
                {isEditing ? `Save ${entityLabel.toLowerCase()}` : `Create ${entityLabel.toLowerCase()}`}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function SubcategoryForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setIsAdding(false);
    }
  }, [editingItem]);

  function openAddSubcategory() {
    clearEditing?.();
    setIsAdding(true);
  }

  function closeSubcategoryModal() {
    if (saving) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
  }

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
      setIsAdding(false);
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
    <>
      <div className="definition-panel-actions">
        <button className="link-button" onClick={openAddSubcategory} type="button">+ Add subcategory</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeSubcategoryModal()} role="presentation">
          <ModalEscape onClose={closeSubcategoryModal} />
          <form aria-labelledby="subcategory-modal-title" aria-modal="true" className="definition-modal" key={editingItem?.id || "new-subcategory"} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id="subcategory-modal-title">{isEditing ? "Edit subcategory" : "Add subcategory"}</h3>
                <span>{editingItem?.name || "New subcategory"}</span>
              </div>
              <CloseButton disabled={saving} onClick={closeSubcategoryModal} />
            </div>
            <div className="definition-modal-body">
              <div className="compact-form">
                <FormField label="Category"><Select defaultValue={editingItem?.category?.id || ""} name="category_id" options={refs.categories.map((item) => [item.id, item.name])} required /></FormField>
                <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Subcategory name" required /></FormField>
                <ColorInput initialValue={editingItem?.color || ""} label="Color" name="color" />
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button modal-action-cancel" disabled={saving} onClick={closeSubcategoryModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" type="submit">
                {isEditing ? "Save subcategory" : "Create subcategory"}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
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

// tags: show the options as tag pills (TagToggleList) in these tags' colours.
function DefinitionCheckboxField({ className = "", helpText = "", label, onChange, options, placeholder = "None selected", tags, value }) {
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
        <span className="definition-checkbox-title">
          {label}
          {helpText && <HelpTooltip text={helpText} />}
        </span>
        <div className="prototype-filter-actions">
          <span className="filter-count">{selectedValues.length ? `${selectedValues.length} selected` : placeholder}</span>
          {selectedValues.length > 0 && (
            <button className="filter-clear inline-clear" onClick={() => onChange([])} type="button">Clear</button>
          )}
        </div>
      </div>
      <div className="definition-checkbox-list">
        {!options.length ? (
          <div className="filter-no-matches">No options</div>
        ) : tags ? (
          <TagToggleList label={label} onToggle={toggleOption} options={options} tags={tags} value={selectedValues} />
        ) : options.map(([optionValue, text]) => (
          <label className="checkbox-filter-row" key={optionValue} title={text}>
            <input
              checked={selectedSet.has(optionValue)}
              onChange={() => toggleOption(optionValue)}
              type="checkbox"
            />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function KeywordForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [tagIds, setTagIds] = useState(() => (editingItem?.tags || []).map((item) => item.id));
  const [previewResult, setPreviewResult] = useState(null);
  const [previewText, setPreviewText] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingItem) {
      if (!isAdding) {
        setTagIds([]);
        setPreviewResult(null);
        setPreviewText("");
      }
      return;
    }
    setIsAdding(false);
    setTagIds((editingItem?.tags || []).map((item) => item.id));
    setPreviewResult(null);
    setPreviewText("");
  }, [editingItem, isAdding]);

  function openAddKeyword() {
    clearEditing?.();
    setTagIds([]);
    setPreviewResult(null);
    setPreviewText("");
    setIsAdding(true);
  }

  function closeKeywordModal() {
    if (saving || previewing) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
    setTagIds([]);
    setPreviewResult(null);
    setPreviewText("");
  }

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
      setIsAdding(false);
      clearEditing?.();
      setTagIds([]);
      setPreviewResult(null);
      setPreviewText("");
      notify(isEditing ? "Keyword saved" : "Keyword added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function previewKeywordMatch() {
    const text = previewText.trim();
    if (!text) {
      notify("Enter preview text");
      return;
    }
    setPreviewing(true);
    try {
      setPreviewResult(await apiPost("/keywords/preview/", { text }));
    } catch (error) {
      notify(error.message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <>
      <div className="definition-panel-actions">
        <button className="link-button" onClick={openAddKeyword} type="button">+ Add keyword</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeKeywordModal()} role="presentation">
          <ModalEscape onClose={closeKeywordModal} />
          <form aria-labelledby="keyword-modal-title" aria-modal="true" className="definition-modal keyword-modal" key={editingItem?.id || "new-keyword"} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id="keyword-modal-title">{isEditing ? "Edit keyword" : "Add keyword"}</h3>
                <span>{editingItem?.name || "New keyword"}</span>
              </div>
              <CloseButton disabled={saving || previewing} onClick={closeKeywordModal} />
            </div>
            <div className="definition-modal-body">
              <div className="compact-form keyword-form">
                <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Keyword name" required /></FormField>
                <FormField label="Include terms"><textarea defaultValue={(editingItem?.include_terms || []).join("\n")} name="include_terms" placeholder="One term per line" required rows="3" /></FormField>
                <FormField label="Exclude terms"><textarea defaultValue={(editingItem?.exclude_terms || []).join("\n")} name="exclude_terms" placeholder="One term per line" rows="3" /></FormField>
                <FormField label="Subcategory"><Select blank="No subcategory" defaultValue={editingItem?.subcategory?.id || ""} name="subcategory_id" options={refs.subcategories.map((item) => [item.id, subLabel(item)])} /></FormField>
                <FormField label="Want / Need / Investment"><Select blank="No WNI" defaultValue={editingItem?.want_need_investment || ""} name="want_need_investment" options={wniOptions} /></FormField>
                <DefinitionCheckboxField label="Tags" onChange={setTagIds} options={refs.tags.map((item) => [item.id, item.name])} placeholder="No tags selected" tags={refs.tags} value={tagIds} />
                <FormField label="Priority"><input defaultValue={editingItem?.priority ?? "0"} name="priority" type="number" /></FormField>
                <label className="check-row"><input defaultChecked={Boolean(editingItem?.is_ignored)} name="is_ignored" type="checkbox" /><span>Ignore matches</span></label>
                <div className="keyword-preview-panel">
                  <FormField label="Preview text"><textarea onChange={(event) => setPreviewText(event.target.value)} placeholder="Paste transaction text" rows="2" value={previewText} /></FormField>
                  <LoadingButton busy={previewing} busyLabel="Previewing" className="link-button" onClick={previewKeywordMatch} type="button">Preview matches</LoadingButton>
                  {previewResult && (
                    <div className="keyword-preview-result">
                      <div className={`keyword-preview-status status-${previewResult.categorization.status}`}>
                        {titleCase(previewResult.categorization.status)}
                      </div>
                      {previewResult.categorization.conflict_reason && (
                        <div className="conflict-detail-reason">{previewResult.categorization.conflict_reason}</div>
                      )}
                      <KeywordMatchList matches={previewResult.categorization.matched_keywords || []} />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button modal-action-cancel" disabled={saving || previewing} onClick={closeKeywordModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" disabled={previewing} type="submit">
                {isEditing ? "Save keyword" : "Create keyword"}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
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
            <KeywordMatchTarget match={match} />
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

function KeywordMatchTarget({ match }) {
  const target = match.subcategory
    ? `${match.category?.name || "Uncategorized"} / ${match.subcategory.name}`
    : "No subcategory";
  return (
    <>
      {target}
      {match.want_need_investment ? ` - ${titleCase(match.want_need_investment)}` : ""}
      {match.is_ignored ? " - Ignored" : ""}
    </>
  );
}
