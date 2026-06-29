import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

import { apiDelete, apiGet, apiPost } from "../api.js";
import { LoadingButton, ModalShell } from "../components.jsx";
import {
  UNASSIGNED,
  baseLayout,
  buildMetrics,
  cloneFilters,
  colorPillStyle,
  completeMonthlyRows,
  countActiveFilters,
  cssVar,
  formatAmountWithCurrency,
  formatAmountValue,
  formatCount,
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

const emptyKeywordDraft = {
  name: "",
  include_terms: "",
  exclude_terms: "",
  subcategory_id: "",
  want_need_investment: "",
  tag_ids: [],
  priority: 0,
  is_ignored: false,
};

const NO_BULK_CHANGE = "__no_change__";
const CLEAR_BULK_VALUE = "__clear__";

const emptyBulkAssignDraft = {
  subcategory: NO_BULK_CHANGE,
  tagMode: "no_change",
  tagIds: [],
  wantNeedInvestment: NO_BULK_CHANGE,
  ignored: NO_BULK_CHANGE,
  locked: NO_BULK_CHANGE,
};

export default function DashboardPage({
  confirmAction,
  filters,
  filterParams,
  hideAmounts,
  importBusy,
  notify,
  onFilterChange,
  recategorizeResult,
  refs,
  reloadAll,
  reloadDashboard,
  setFilters,
  setRecategorizeResult,
  summary,
  transactionPage,
  updateTransaction,
}) {
  const defaultCurrency = summary?.default_currency || refs.settings?.default_currency || "CZK";
  const metrics = useMemo(
    () => buildMetrics(summary, transactionPage, hideAmounts, defaultCurrency),
    [defaultCurrency, hideAmounts, summary, transactionPage],
  );
  const conflictIds = useMemo(
    () => new Set(recategorizeResult?.conflict_transaction_ids || []),
    [recategorizeResult],
  );
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [bulkAssignEditorOpen, setBulkAssignEditorOpen] = useState(false);
  const [bulkAssignDraft, setBulkAssignDraft] = useState(emptyBulkAssignDraft);
  const [bulkAssignBusy, setBulkAssignBusy] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  const [recategorizeModalOpen, setRecategorizeModalOpen] = useState(false);
  const [recategorizeIncludeLocked, setRecategorizeIncludeLocked] = useState(false);
  const [savedFilterName, setSavedFilterName] = useState("");
  const [savedFilters, setSavedFilters] = useState([]);
  const [savedFiltersBusy, setSavedFiltersBusy] = useState(false);
  const [uncategorizedReviewOpen, setUncategorizedReviewOpen] = useState(false);
  const [uncategorizedSuggestions, setUncategorizedSuggestions] = useState([]);
  const [uncategorizedSuggestionMeta, setUncategorizedSuggestionMeta] = useState({ count: 0, transaction_count: 0 });
  const [uncategorizedSuggestionsLoading, setUncategorizedSuggestionsLoading] = useState(false);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState("");
  const [keywordDraft, setKeywordDraft] = useState(emptyKeywordDraft);
  const [keywordDraftBusy, setKeywordDraftBusy] = useState("");
  const [uncategorizedReviewError, setUncategorizedReviewError] = useState("");
  const [transferReviewOpen, setTransferReviewOpen] = useState(false);
  const [transferCandidates, setTransferCandidates] = useState([]);
  const [transferMeta, setTransferMeta] = useState({ count: 0, high_confidence_count: 0, medium_confidence_count: 0, ambiguous_count: 0 });
  const [transferDateTolerance, setTransferDateTolerance] = useState(3);
  const [transferIncludeIgnored, setTransferIncludeIgnored] = useState(false);
  const [transferIncludeLocked, setTransferIncludeLocked] = useState(false);
  const [selectedTransferIds, setSelectedTransferIds] = useState([]);
  const [transferSubcategoryId, setTransferSubcategoryId] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferApplying, setTransferApplying] = useState(false);
  const [transferError, setTransferError] = useState("");
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

  function openRecategorizeModal() {
    if (!transactionPage.count) {
      notify("No filtered transactions");
      return;
    }
    setRecategorizeIncludeLocked(false);
    setRecategorizeModalOpen(true);
  }

  function closeRecategorizeModal() {
    if (recategorizing) {
      return;
    }
    setRecategorizeModalOpen(false);
  }

  async function recategorize() {
    if (!transactionPage.count) {
      notify("No filtered transactions");
      return;
    }
    setRecategorizing(true);
    try {
      const params = { ...filterParams };
      if (recategorizeIncludeLocked) {
        params.include_locked = "true";
      } else {
        delete params.include_locked;
      }
      const result = await apiPost("/transactions/recategorize/", { include_locked: recategorizeIncludeLocked }, params);
      setRecategorizeResult(result);
      setRecategorizeModalOpen(false);
      notify(`${formatCount(result.updated)} transactions updated`);
      await reloadDashboard();
    } catch (error) {
      notify(error.message);
    } finally {
      setRecategorizing(false);
    }
  }

  const bulkSubcategoryOptions = useMemo(
    () => [
      [NO_BULK_CHANGE, "No change"],
      [CLEAR_BULK_VALUE, "Unassigned"],
      ...refs.subcategories.map((item) => [item.id, subLabel(item)]),
    ],
    [refs.subcategories],
  );
  const bulkWniOptions = useMemo(
    () => [
      [NO_BULK_CHANGE, "No change"],
      [CLEAR_BULK_VALUE, "Unassigned"],
      ...wniOptions.map(([value, label]) => [value, label]),
    ],
    [],
  );
  const bulkBooleanOptions = [
    [NO_BULK_CHANGE, "No change"],
    ["true", "Yes"],
    ["false", "No"],
  ];
  const transferSubcategoryOptions = useMemo(
    () => [["", "No subcategory"], ...refs.subcategories.map((item) => [item.id, subLabel(item)])],
    [refs.subcategories],
  );
  const selectedSuggestion = useMemo(
    () => uncategorizedSuggestions.find((item) => item.id === selectedSuggestionId) || uncategorizedSuggestions[0] || null,
    [selectedSuggestionId, uncategorizedSuggestions],
  );
  const transferFilterParams = useMemo(() => {
    const params = {
      ...filterParams,
      date_tolerance_days: transferDateTolerance,
      limit: 100,
    };
    if (transferIncludeIgnored) {
      params.include_ignored = "true";
    } else {
      delete params.include_ignored;
    }
    if (transferIncludeLocked) {
      params.include_locked = "true";
    } else {
      delete params.include_locked;
    }
    return params;
  }, [filterParams, transferDateTolerance, transferIncludeIgnored, transferIncludeLocked]);

  const loadTransferCandidates = useCallback(async () => {
    setTransferLoading(true);
    setTransferError("");
    try {
      const payload = await apiGet("/transactions/internal-transfers/preview/", transferFilterParams);
      const candidates = payload.candidates || [];
      setTransferCandidates(candidates);
      setTransferMeta({
        count: payload.count || 0,
        high_confidence_count: payload.high_confidence_count || 0,
        medium_confidence_count: payload.medium_confidence_count || 0,
        ambiguous_count: payload.ambiguous_count || 0,
      });
      setSelectedTransferIds((current) => {
        const currentSet = new Set(current);
        const retained = candidates.filter((candidate) => currentSet.has(candidate.id)).map((candidate) => candidate.id);
        if (retained.length) {
          return retained;
        }
        return candidates
          .filter((candidate) => candidate.confidence_level === "high" && !candidate.is_ambiguous)
          .map((candidate) => candidate.id);
      });
    } catch (error) {
      setTransferError(error.message);
      notify(error.message);
    } finally {
      setTransferLoading(false);
    }
  }, [notify, transferFilterParams]);

  async function loadUncategorizedSuggestions(preferredSuggestionId = selectedSuggestionId) {
    setUncategorizedSuggestionsLoading(true);
    try {
      const payload = await apiGet("/transactions/uncategorized-suggestions/", { ...filterParams, limit: 8 });
      const suggestions = payload.suggestions || [];
      setUncategorizedSuggestions(suggestions);
      setUncategorizedSuggestionMeta({ count: payload.count || 0, transaction_count: payload.transaction_count || 0 });
      const nextSelected = suggestions.find((item) => item.id === preferredSuggestionId) || suggestions[0] || null;
      setSelectedSuggestionId(nextSelected?.id || "");
      setKeywordDraft(keywordDraftFromSuggestion(nextSelected));
    } catch (error) {
      notify(error.message);
    } finally {
      setUncategorizedSuggestionsLoading(false);
    }
  }

  useEffect(() => {
    if (uncategorizedReviewOpen) {
      loadUncategorizedSuggestions();
    }
  }, [filterParams, uncategorizedReviewOpen]);

  useEffect(() => {
    if (transferReviewOpen) {
      loadTransferCandidates();
    }
  }, [loadTransferCandidates, transferReviewOpen]);

  function openTransferReview() {
    setTransferError("");
    setTransferSubcategoryId(refs.settings?.internal_transfer_subcategory?.id || "");
    setTransferReviewOpen(true);
  }

  function toggleTransferCandidate(candidateId) {
    setSelectedTransferIds((current) => (
      current.includes(candidateId)
        ? current.filter((item) => item !== candidateId)
        : [...current, candidateId]
    ));
  }

  async function applySelectedTransfers() {
    if (!selectedTransferIds.length) {
      setTransferError("Choose at least one transfer pair");
      return;
    }
    const confirmed = await confirmAction({
      confirmLabel: "Apply",
      message: `Mark ${formatCount(selectedTransferIds.length)} selected transfer pairs as internal transfers? Both sides will be ignored and locked.`,
      title: "Apply Internal Transfers",
    });
    if (!confirmed) {
      return;
    }
    setTransferApplying(true);
    setTransferError("");
    try {
      const result = await apiPost(
        "/transactions/internal-transfers/apply/",
        {
          candidate_ids: selectedTransferIds,
          date_tolerance_days: transferDateTolerance,
          subcategory_id: transferSubcategoryId,
        },
        transferFilterParams,
      );
      notify(`${formatCount(result.created)} transfer pairs applied`);
      setSelectedTransferIds([]);
      await Promise.all([reloadDashboard(), loadTransferCandidates()]);
    } catch (error) {
      setTransferError(error.message);
      notify(error.message);
    } finally {
      setTransferApplying(false);
    }
  }

  function openBulkAssignEditor() {
    setBulkAssignDraft(emptyBulkAssignDraft);
    setBulkAssignEditorOpen(true);
  }

  function closeBulkAssignEditor() {
    if (bulkAssignBusy) {
      return;
    }
    setBulkAssignEditorOpen(false);
    setBulkAssignDraft(emptyBulkAssignDraft);
  }

  function updateBulkAssignDraft(patch) {
    setBulkAssignDraft((current) => ({ ...current, ...patch }));
  }

  function toggleBulkAssignTag(tagId) {
    setBulkAssignDraft((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((item) => item !== tagId)
        : [...current.tagIds, tagId],
    }));
  }

  function bulkAssignPayload() {
    const payload = {};
    if (bulkAssignDraft.subcategory !== NO_BULK_CHANGE) {
      payload.subcategory_id = bulkAssignDraft.subcategory === CLEAR_BULK_VALUE ? "" : bulkAssignDraft.subcategory;
    }
    if (bulkAssignDraft.tagMode !== "no_change") {
      payload.tag_mode = bulkAssignDraft.tagMode;
      payload.tag_ids = bulkAssignDraft.tagIds;
    }
    if (bulkAssignDraft.wantNeedInvestment !== NO_BULK_CHANGE) {
      payload.want_need_investment = bulkAssignDraft.wantNeedInvestment === CLEAR_BULK_VALUE ? "" : bulkAssignDraft.wantNeedInvestment;
    }
    if (bulkAssignDraft.ignored !== NO_BULK_CHANGE) {
      payload.is_ignored = bulkAssignDraft.ignored === "true";
    }
    if (bulkAssignDraft.locked !== NO_BULK_CHANGE) {
      payload.is_categorization_locked = bulkAssignDraft.locked === "true";
    }
    return payload;
  }

  function bulkAssignHasChanges() {
    return Object.keys(bulkAssignPayload()).length > 0;
  }

  async function submitBulkAssign() {
    const payload = bulkAssignPayload();
    if (!Object.keys(payload).length) {
      notify("Choose at least one bulk assignment");
      return;
    }
    if (["add", "replace"].includes(bulkAssignDraft.tagMode) && !bulkAssignDraft.tagIds.length) {
      notify("Choose at least one tag");
      return;
    }
    setBulkAssignBusy(true);
    try {
      const result = await apiPost("/transactions/bulk-assign/", payload, filterParams);
      notify(`${formatCount(result.updated)} transactions updated`);
      setBulkAssignEditorOpen(false);
      setBulkAssignDraft(emptyBulkAssignDraft);
      await reloadDashboard();
    } catch (error) {
      notify(error.message);
    } finally {
      setBulkAssignBusy(false);
    }
  }

  function selectUncategorizedSuggestion(suggestion) {
    setSelectedSuggestionId(suggestion.id);
    setKeywordDraft(keywordDraftFromSuggestion(suggestion));
    setUncategorizedReviewError("");
  }

  async function createKeywordFromSuggestion(applyToGroup = false) {
    if (!selectedSuggestion) {
      setUncategorizedReviewError("Choose a suggestion first");
      return;
    }
    const includeTerms = textLines(keywordDraft.include_terms);
    if (!includeTerms.length) {
      setUncategorizedReviewError("Add at least one include term");
      return;
    }
    const hasAssignment = Boolean(
      keywordDraft.subcategory_id
      || keywordDraft.want_need_investment
      || keywordDraft.tag_ids.length
      || keywordDraft.is_ignored,
    );
    if (!hasAssignment) {
      setUncategorizedReviewError("Choose a category, WNI, tag, or ignore action");
      return;
    }
    setUncategorizedReviewError("");
    setKeywordDraftBusy(applyToGroup ? "create-apply" : "create");
    try {
      await apiPost("/keywords/", {
        name: keywordDraft.name.trim() || selectedSuggestion.sample_description,
        include_terms: includeTerms,
        exclude_terms: textLines(keywordDraft.exclude_terms),
        subcategory_id: keywordDraft.subcategory_id || "",
        want_need_investment: keywordDraft.want_need_investment || "",
        tag_ids: keywordDraft.tag_ids,
        is_ignored: keywordDraft.is_ignored,
        priority: Number(keywordDraft.priority || 0),
        is_active: true,
      });
      await reloadAll();
      if (applyToGroup) {
        const result = await apiPost("/transactions/recategorize/", {
          transaction_ids: selectedSuggestion.transaction_ids || [],
        });
        setRecategorizeResult(result);
        notify(`${formatCount(result.updated)} transactions updated`);
        await Promise.all([reloadDashboard(), loadUncategorizedSuggestions()]);
      } else {
        notify("Keyword added");
        await loadUncategorizedSuggestions();
      }
    } catch (error) {
      setUncategorizedReviewError(error.message);
    } finally {
      setKeywordDraftBusy("");
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
              </div>
              <div className="filter-card filter-display-card">
                <div className="filter-card-header">
                  <span className="filter-label">Display</span>
                </div>
                <div className="filter-display-options">
                  <div className="check-row">
                    <label className="check-row-label">
                      <input checked={filters.split_by_owners} onChange={(event) => onFilterChange("split_by_owners", event.target.checked)} type="checkbox" />
                      <span>Divide by account owner count</span>
                    </label>
                    <HelpTooltip text="Divides account amounts by that account's owner count for dashboard totals and displayed transaction amounts." />
                  </div>
                  <div className="check-row">
                    <label className="check-row-label">
                      <input checked={filters.include_ignored} onChange={(event) => onFilterChange("include_ignored", event.target.checked)} type="checkbox" />
                      <span>Ignored</span>
                    </label>
                    <HelpTooltip text="Includes transactions marked as ignored in the dashboard, charts, and transaction table." />
                  </div>
                  <div className="check-row">
                    <label className="check-row-label">
                      <input checked={filters.include_locked} onChange={(event) => onFilterChange("include_locked", event.target.checked)} type="checkbox" />
                      <span>Locked</span>
                    </label>
                    <HelpTooltip text="Includes transactions whose categorization is locked and protected from automatic recategorization." />
                  </div>
                </div>
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
            <div className="dashboard-action-grid">
              <LoadingButton
                busy={recategorizing}
                busyLabel="Recategorizing"
                className="link-button"
                disabled={!transactionPage.count || importBusy}
                onClick={openRecategorizeModal}
                type="button"
              >
                Recategorize
              </LoadingButton>
              <button className="link-button" disabled={!transactionPage.count || importBusy} onClick={openBulkAssignEditor} type="button">
                Bulk assign
              </button>
              <LoadingButton
                busy={transferLoading && transferReviewOpen}
                busyLabel="Scanning"
                className="link-button"
                disabled={!transactionPage.count || importBusy}
                onClick={openTransferReview}
                type="button"
              >
                Find transfers
              </LoadingButton>
              <LoadingButton
                busy={uncategorizedSuggestionsLoading && uncategorizedReviewOpen}
                busyLabel="Loading"
                className="link-button"
                disabled={importBusy}
                onClick={() => {
                  setUncategorizedReviewError("");
                  setUncategorizedReviewOpen(true);
                }}
                type="button"
              >
                Review uncategorized
              </LoadingButton>
            </div>
          </div>
        </section>
      </div>
      {recategorizeModalOpen && (
        <RecategorizeModal
          busy={recategorizing}
          count={transactionPage.count}
          includeLocked={recategorizeIncludeLocked}
          onClose={closeRecategorizeModal}
          onIncludeLockedChange={setRecategorizeIncludeLocked}
          onSubmit={recategorize}
        />
      )}
      {transferReviewOpen && (
        <InternalTransferReviewPanel
          applying={transferApplying}
          busy={transferLoading}
          candidates={transferCandidates}
          dateTolerance={transferDateTolerance}
          error={transferError}
          hideAmounts={hideAmounts}
          includeIgnored={transferIncludeIgnored}
          includeLocked={transferIncludeLocked}
          meta={transferMeta}
          onApply={applySelectedTransfers}
          onClose={() => {
            if (!transferApplying) {
              setTransferReviewOpen(false);
            }
          }}
          onDateToleranceChange={setTransferDateTolerance}
          onIncludeIgnoredChange={setTransferIncludeIgnored}
          onIncludeLockedChange={setTransferIncludeLocked}
          onSubcategoryChange={setTransferSubcategoryId}
          onToggleCandidate={toggleTransferCandidate}
          selectedIds={selectedTransferIds}
          subcategoryId={transferSubcategoryId}
          subcategoryOptions={transferSubcategoryOptions}
        />
      )}
      {uncategorizedReviewOpen && (
        <UncategorizedReviewPanel
          busy={uncategorizedSuggestionsLoading}
          defaultCurrency={defaultCurrency}
          draft={keywordDraft}
          error={uncategorizedReviewError}
          hideAmounts={hideAmounts}
          meta={uncategorizedSuggestionMeta}
          onClearError={() => setUncategorizedReviewError("")}
          onCreateKeyword={() => createKeywordFromSuggestion(false)}
          onCreateKeywordAndApply={() => createKeywordFromSuggestion(true)}
          onClose={() => {
            if (!keywordDraftBusy) {
              setUncategorizedReviewError("");
              setUncategorizedReviewOpen(false);
            }
          }}
          onDraftChange={setKeywordDraft}
          onSelectSuggestion={selectUncategorizedSuggestion}
          refs={refs}
          selectedSuggestion={selectedSuggestion}
          submitting={keywordDraftBusy}
          suggestions={uncategorizedSuggestions}
        />
      )}
      {bulkAssignEditorOpen && (
        <BulkAssignMultiModal
          busy={bulkAssignBusy}
          count={transactionPage.count}
          draft={bulkAssignDraft}
          hasChanges={bulkAssignHasChanges()}
          onClose={closeBulkAssignEditor}
          onSubmit={submitBulkAssign}
          onTagToggle={toggleBulkAssignTag}
          onUpdate={updateBulkAssignDraft}
          booleanOptions={bulkBooleanOptions}
          subcategoryOptions={bulkSubcategoryOptions}
          tags={refs.tags}
          wniOptions={bulkWniOptions}
        />
      )}
      {recategorizeResult && <RecategorizeStats result={recategorizeResult} />}
      {summary?.missing_conversions ? (
        <div className="dashboard-warning">
          {formatCount(summary.missing_conversions)} filtered transactions are missing exchange rates and are excluded from converted totals.
        </div>
      ) : null}

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
          <span className="muted">{formatCount(transactionPage.count)} shown</span>
        </div>
        <TransactionGrid conflictIds={conflictIds} defaultCurrency={defaultCurrency} filters={filters} hideAmounts={hideAmounts} notify={notify} refs={refs} rows={transactionPage.results} updateTransaction={updateTransaction} />
      </section>
    </>
  );
}

function keywordDraftFromSuggestion(suggestion) {
  if (!suggestion) {
    return { ...emptyKeywordDraft, tag_ids: [] };
  }
  const keyword = suggestion.suggested_keyword || {};
  return {
    name: keyword.name || "",
    include_terms: (keyword.include_terms || []).join("\n"),
    exclude_terms: (keyword.exclude_terms || []).join("\n"),
    subcategory_id: "",
    want_need_investment: "",
    tag_ids: [],
    priority: keyword.priority ?? 0,
    is_ignored: Boolean(keyword.is_ignored),
  };
}

function textLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function HelpTooltip({ text }) {
  return (
    <span className="help-tooltip">
      <button aria-label={text} className="help-tooltip-button" type="button">?</button>
      <span className="help-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

function RecategorizeModal({
  busy,
  count,
  includeLocked,
  onClose,
  onIncludeLockedChange,
  onSubmit,
}) {
  return (
    <ModalShell
      className="recategorize-modal"
      closeDisabled={busy}
      closeLabel="Close recategorize modal"
      description="This will rerun keyword categorization for the current filtered scope. Locked transactions are skipped unless included here."
      onClose={onClose}
      title="Recategorize"
      titleId="recategorize-modal-title"
    >
        <div className="bulk-assign-warning">
          Current filters show {formatCount(count)} transactions.
        </div>
        <label className="check-row recategorize-modal-toggle">
          <input checked={includeLocked} disabled={busy} onChange={(event) => onIncludeLockedChange(event.target.checked)} type="checkbox" />
          <span>Include locked transactions</span>
        </label>
        {includeLocked && (
          <div className="recategorize-locked-warning">
            Locked transactions may contain manual corrections. Recategorizing them can overwrite subcategory, WNI, tags, ignored state, and refreshed mapped fields.
          </div>
        )}
        <div className="bulk-assign-modal-actions">
          <button className="link-button" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <LoadingButton busy={busy} busyLabel="Recategorizing" className="primary-action" onClick={onSubmit} type="button">
            Recategorize
          </LoadingButton>
        </div>
    </ModalShell>
  );
}

function BulkAssignMultiModal({
  booleanOptions,
  busy,
  count,
  draft,
  hasChanges,
  onClose,
  onSubmit,
  onTagToggle,
  onUpdate,
  subcategoryOptions,
  tags,
  wniOptions,
}) {
  const tagSelectionDisabled = !["add", "replace"].includes(draft.tagMode);
  return (
    <ModalShell
      className="bulk-assign-modal"
      closeDisabled={busy}
      closeLabel="Close bulk assign modal"
      description={`This will update ${formatCount(count)} currently filtered transactions. Category, tag, WNI, or ignored changes will lock categorization unless you explicitly set Locked to No.`}
      onClose={onClose}
      title="Bulk Assign"
      titleId="bulk-assign-modal-title"
    >
        <div className="bulk-assign-form">
          <label className="form-field">
            <span>Subcategory</span>
            <select autoFocus disabled={busy} onChange={(event) => onUpdate({ subcategory: event.target.value })} value={draft.subcategory}>
              {subcategoryOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>WNI</span>
            <select disabled={busy} onChange={(event) => onUpdate({ wantNeedInvestment: event.target.value })} value={draft.wantNeedInvestment}>
              {wniOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Ignored</span>
            <select disabled={busy} onChange={(event) => onUpdate({ ignored: event.target.value })} value={draft.ignored}>
              {booleanOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Locked</span>
            <select disabled={busy} onChange={(event) => onUpdate({ locked: event.target.value })} value={draft.locked}>
              {booleanOptions.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
          <label className="form-field bulk-tag-mode-field">
            <span>Tags</span>
            <select disabled={busy} onChange={(event) => onUpdate({ tagMode: event.target.value })} value={draft.tagMode}>
              <option value="no_change">No change</option>
              <option value="add">Add selected tags</option>
              <option value="replace">Replace with selected tags</option>
              <option value="clear">Clear all tags</option>
            </select>
          </label>
          <div className={`bulk-tag-picker ${tagSelectionDisabled ? "is-disabled" : ""}`.trim()}>
            {tags.length ? tags.map((tag) => (
              <label className="check-row" key={tag.id}>
                <input
                  checked={draft.tagIds.includes(tag.id)}
                  disabled={busy || tagSelectionDisabled}
                  onChange={() => onTagToggle(tag.id)}
                  type="checkbox"
                />
                <span>{tag.name}</span>
              </label>
            )) : <span className="muted">No tags defined</span>}
          </div>
        </div>
        <div className="bulk-assign-modal-actions">
          <button className="link-button" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <LoadingButton busy={busy} busyLabel="Assigning" className="primary-action" disabled={!hasChanges} onClick={onSubmit} type="button">
            Apply
          </LoadingButton>
        </div>
    </ModalShell>
  );
}

function InternalTransferReviewPanel({
  applying,
  busy,
  candidates,
  dateTolerance,
  error,
  hideAmounts,
  includeIgnored,
  includeLocked,
  meta,
  onApply,
  onClose,
  onDateToleranceChange,
  onIncludeIgnoredChange,
  onIncludeLockedChange,
  onSubcategoryChange,
  onToggleCandidate,
  selectedIds,
  subcategoryId,
  subcategoryOptions,
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  return (
    <ModalShell
      className="transfer-review-modal"
      closeDisabled={applying}
      closeLabel="Close transfer review"
      description="Scan the current filtered scope for matching outgoing and incoming transactions across defined accounts."
      headerClassName="transfer-review-modal-header"
      onClose={onClose}
      title="Find Transfers"
      titleId="transfer-review-title"
    >
        <div className="transfer-review-layout">
          <div className="bulk-assign-warning transfer-review-summary">
            {formatCount(meta.count)} candidates. {formatCount(meta.high_confidence_count)} high confidence, {formatCount(meta.ambiguous_count)} ambiguous.
          </div>
          <div className="transfer-review-controls">
            <label className="form-field">
              <span>Date offset</span>
              <input
                min="0"
                max="14"
                onChange={(event) => onDateToleranceChange(Number(event.target.value || 0))}
                type="number"
                value={dateTolerance}
              />
            </label>
            <label className="check-row">
              <input checked={includeIgnored} onChange={(event) => onIncludeIgnoredChange(event.target.checked)} type="checkbox" />
              <span>Include ignored</span>
            </label>
            <label className="check-row">
              <input checked={includeLocked} onChange={(event) => onIncludeLockedChange(event.target.checked)} type="checkbox" />
              <span>Include locked</span>
            </label>
          </div>
          {error && <div className="transfer-review-error">{error}</div>}
          <div className="transfer-candidate-list">
            {busy && !candidates.length ? (
              <div className="transfer-empty-state">Scanning filtered transactions</div>
            ) : candidates.length ? (
              candidates.map((candidate) => (
                <InternalTransferCandidateCard
                  candidate={candidate}
                  checked={selectedSet.has(candidate.id)}
                  hideAmounts={hideAmounts}
                  key={candidate.id}
                  onToggle={() => onToggleCandidate(candidate.id)}
                />
              ))
            ) : (
              <div className="transfer-empty-state">No transfer candidates found in the current filter scope.</div>
            )}
          </div>
          <div className="transfer-review-actions">
            <span>{formatCount(selectedIds.length)} selected</span>
            <label className="transfer-apply-subcategory">
              <span>Subcategory</span>
              <select disabled={applying} onChange={(event) => onSubcategoryChange(event.target.value)} value={subcategoryId}>
                {subcategoryOptions.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
              </select>
            </label>
            <LoadingButton busy={applying} busyLabel="Applying" className="primary-action transfer-apply-button" disabled={!selectedIds.length || busy} onClick={onApply} type="button">
              Apply
            </LoadingButton>
          </div>
        </div>
    </ModalShell>
  );
}

function InternalTransferCandidateCard({ candidate, checked, hideAmounts, onToggle }) {
  return (
    <label className={`transfer-candidate-card ${checked ? "is-selected" : ""}`.trim()}>
      <input checked={checked} onChange={onToggle} type="checkbox" />
      <div className="transfer-candidate-body">
        <div className="transfer-candidate-header">
          <strong>{titleCase(candidate.confidence_level)} confidence</strong>
        </div>
        <div className="transfer-pair-grid">
          <TransferTransactionSummary label="Outgoing" transaction={candidate.outgoing} hideAmounts={hideAmounts} />
          <TransferTransactionSummary label="Incoming" transaction={candidate.incoming} hideAmounts={hideAmounts} />
        </div>
        <div className="transfer-reason-list">
          {(candidate.match_reasons || []).map((reason) => {
            const reasonLabel = typeof reason === "string" ? reason : reason.label;
            const reasonTone = typeof reason === "string" ? "" : reason.tone;
            return <span className={reasonTone ? `is-${reasonTone}` : ""} key={reasonLabel}>{reasonLabel}</span>;
          })}
        </div>
      </div>
    </label>
  );
}

function TransferTransactionSummary({ hideAmounts, label, transaction }) {
  return (
    <div className="transfer-transaction-summary">
      <div>
        <strong>{label}</strong>
        <span>{transaction.bank_account?.name || "No account"}</span>
      </div>
      <div className="transfer-transaction-main">
        <span>{transaction.transaction_date}</span>
        <strong>{formatAmountWithCurrency(transaction.amount, transaction.currency, hideAmounts)}</strong>
      </div>
      <p>{transaction.description || transaction.counterparty_name || "No description"}</p>
      {transaction.counterparty_account_number ? <span className="muted">{transaction.counterparty_account_number}</span> : null}
    </div>
  );
}

function UncategorizedReviewPanel({
  busy,
  defaultCurrency,
  draft,
  error,
  hideAmounts,
  meta,
  onClearError,
  onCreateKeyword,
  onCreateKeywordAndApply,
  onClose,
  onDraftChange,
  onSelectSuggestion,
  refs,
  selectedSuggestion,
  submitting,
  suggestions,
}) {
  function updateDraft(patch) {
    onClearError();
    onDraftChange((current) => ({ ...current, ...patch }));
  }

  function toggleTag(tagId) {
    onClearError();
    onDraftChange((current) => {
      const selectedTags = new Set(current.tag_ids || []);
      if (selectedTags.has(tagId)) {
        selectedTags.delete(tagId);
      } else {
        selectedTags.add(tagId);
      }
      return { ...current, tag_ids: [...selectedTags] };
    });
  }

  return (
    <ModalShell
      className="uncategorized-review-modal"
      closeDisabled={Boolean(submitting)}
      closeLabel="Close uncategorized review"
      description="Review uncategorized transaction groups and create a keyword rule from the selected suggestion."
      headerClassName="uncategorized-review-modal-header"
      onClose={onClose}
      title="Review Uncategorized"
      titleId="uncategorized-review-title"
    >
        <div className="uncategorized-review-layout">
          <div className="bulk-assign-warning uncategorized-review-summary">
            {formatCount(meta.transaction_count)} transactions in{" "}
            {formatCount(meta.count)} groups
          </div>
          {error ? <div className="uncategorized-review-error">{error}</div> : null}
          <div className="uncategorized-suggestion-list">
          {busy && !suggestions.length ? (
            <div className="uncategorized-empty-state">Loading suggestions...</div>
          ) : suggestions.length ? (
            suggestions.map((suggestion) => (
              <button
                className={`uncategorized-suggestion-card ${
                  selectedSuggestion?.id === suggestion.id ? "is-active" : ""
                }`}
                key={suggestion.id}
                onClick={() => onSelectSuggestion(suggestion)}
                type="button"
              >
                <span className="suggestion-card-title">{suggestion.sample_description}</span>
                <span className="suggestion-card-meta">
                  {suggestion.reason} | {formatCount(suggestion.transaction_count)} transactions
                </span>
                <span className="suggestion-card-amount">
                  {formatAmountWithCurrency(
                    suggestion.total_amount,
                    suggestion.currency || defaultCurrency,
                    hideAmounts,
                  )}
                </span>
              </button>
            ))
          ) : (
            <div className="uncategorized-empty-state">
              No uncategorized suggestions for the current filters.
            </div>
          )}
        </div>

          <div className="uncategorized-detail-panel">
          {selectedSuggestion ? (
            <>
              <div className="uncategorized-detail-header">
                <div>
                  <h3>{selectedSuggestion.sample_description}</h3>
                  <span>{selectedSuggestion.date_from} - {selectedSuggestion.date_to}</span>
                </div>
                <strong>
                  {formatAmountWithCurrency(
                    selectedSuggestion.total_amount,
                    selectedSuggestion.currency || defaultCurrency,
                    hideAmounts,
                  )}
                </strong>
              </div>
              <div className="uncategorized-keyword-form">
                <label className="form-field">
                  <span>Keyword name</span>
                  <input
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    type="text"
                    value={draft.name}
                  />
                </label>
                <label className="form-field">
                  <span>Include terms</span>
                  <textarea
                    onChange={(event) => updateDraft({ include_terms: event.target.value })}
                    rows="3"
                    value={draft.include_terms}
                  />
                </label>
                <label className="form-field">
                  <span>Exclude terms</span>
                  <textarea
                    onChange={(event) => updateDraft({ exclude_terms: event.target.value })}
                    rows="3"
                    value={draft.exclude_terms}
                  />
                </label>
                <label className="form-field">
                  <span>Subcategory</span>
                  <select
                    onChange={(event) => updateDraft({ subcategory_id: event.target.value })}
                    value={draft.subcategory_id}
                  >
                    <option value="">No subcategory</option>
                    {refs.subcategories.map((item) => (
                      <option key={item.id} value={item.id}>{subLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>WNI</span>
                  <select
                    onChange={(event) => updateDraft({ want_need_investment: event.target.value })}
                    value={draft.want_need_investment}
                  >
                    <option value="">No WNI</option>
                    {wniOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <input
                    onChange={(event) => updateDraft({ priority: event.target.value })}
                    type="number"
                    value={draft.priority}
                  />
                </label>
                <div className="uncategorized-tag-field">
                  <span>Tags</span>
                  <div className="uncategorized-tag-list">
                    {refs.tags.length ? refs.tags.map((tag) => (
                      <label className="check-row" key={tag.id}>
                        <input
                          checked={(draft.tag_ids || []).includes(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                          type="checkbox"
                        />
                        <span>{tag.name}</span>
                      </label>
                    )) : <span className="muted">No tags</span>}
                  </div>
                </div>
                <label className="check-row uncategorized-ignore-row">
                  <input
                    checked={draft.is_ignored}
                    onChange={(event) => updateDraft({ is_ignored: event.target.checked })}
                    type="checkbox"
                  />
                  <span>Ignore matches</span>
                </label>
              </div>
              <div className="uncategorized-sample-table">
                <div className="uncategorized-sample-header">
                  <span>Sample transactions</span>
                  <span>{formatCount(selectedSuggestion.transaction_count)} total</span>
                </div>
                {selectedSuggestion.sample_transactions.map((transaction) => (
                  <div className="uncategorized-sample-row" key={transaction.id}>
                    <span>{transaction.transaction_date}</span>
                    <span>{transaction.description}</span>
                    <strong>
                      {formatAmountWithCurrency(
                        transaction.converted_amount ?? transaction.amount,
                        transaction.converted_currency || transaction.currency || defaultCurrency,
                        hideAmounts,
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="uncategorized-review-actions">
                <LoadingButton
                  busy={submitting === "create"}
                  busyLabel="Creating"
                  className="link-button"
                  disabled={Boolean(submitting)}
                  onClick={onCreateKeyword}
                  type="button"
                >
                  Create Keyword
                </LoadingButton>
                <LoadingButton
                  busy={submitting === "create-apply"}
                  busyLabel="Applying"
                  className="primary-action"
                  disabled={Boolean(submitting)}
                  onClick={onCreateKeywordAndApply}
                  type="button"
                >
                  Create & Apply
                </LoadingButton>
              </div>
            </>
          ) : (
            <div className="uncategorized-empty-state">Choose a suggestion</div>
          )}
          </div>
        </div>
    </ModalShell>
  );
}

function IconSvg({ children }) {
  return (
    <svg aria-hidden="true" className="icon-svg" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      {children}
    </svg>
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

function InfoIcon() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </IconSvg>
  );
}

const FILTER_RETAINED_TOOLTIP = "Saved value no longer matches the current filters, so this row is kept visible temporarily.";

function TransactionGrid({ conflictIds, defaultCurrency, filters, hideAmounts, notify, refs, rows, updateTransaction }) {
  const [rawDataPopover, setRawDataPopover] = useState(null);
  const [filterRetainedCells, setFilterRetainedCells] = useState({});
  const rawDataPopoverRef = useRef(null);
  const subcategoryOptions = useMemo(
    () => [["", "Unassigned"], ...refs.subcategories.map((item) => [item.id, subLabel(item)])],
    [refs.subcategories],
  );
  const subcategoryLookup = useMemo(() => new Map(refs.subcategories.map((item) => [item.id, item])), [refs.subcategories]);
  const categoryLookup = useMemo(() => new Map(refs.categories.map((item) => [item.id, item])), [refs.categories]);
  const accountLookup = useMemo(() => new Map(refs.accounts.map((item) => [item.id, item.name])), [refs.accounts]);
  const accountMappingLookup = useMemo(
    () => new Map(refs.accounts.map((item) => [item.id, item.default_csv_mapping?.id || ""])),
    [refs.accounts],
  );
  const mappingLookup = useMemo(() => new Map(refs.mappings.map((item) => [item.id, item])), [refs.mappings]);
  const filterSignature = useMemo(() => JSON.stringify(filters), [filters]);

  const rowData = useMemo(() => rows.map((row) => ({
    ...row,
    account_id: row.bank_account?.id || "",
    categorization_conflict: conflictIds.has(row.id),
    subcategory_id: row.subcategory?.id || "",
  })), [conflictIds, rows]);

  useEffect(() => {
    setFilterRetainedCells({});
  }, [filterSignature]);

  const getRetainedCellMarker = useCallback((params) => {
    const field = params.colDef?.field;
    const rowId = params.data?.id;
    if (!field || !rowId) {
      return false;
    }
    return Boolean(filterRetainedCells[rowId]?.[field]);
  }, [filterRetainedCells]);

  const retainedCellClass = useCallback((params, baseClass = "") => {
    return joinClassNames(baseClass, getRetainedCellMarker(params) ? "filter-retained-cell" : "");
  }, [getRetainedCellMarker]);

  const retainedCellTooltip = useCallback((params) => (
    getRetainedCellMarker(params) ? FILTER_RETAINED_TOOLTIP : null
  ), [getRetainedCellMarker]);

  const saveTransaction = useCallback(async (row, patch) => {
    const updated = await updateTransaction(row, patch);
    const changedFields = changedTransactionCellFields(patch);
    const isRetainedByEdit = changedFields.length > 0 && !transactionMatchesCurrentFilters(updated, filters);
    setFilterRetainedCells((current) => {
      const next = { ...current };
      if (!isRetainedByEdit) {
        delete next[updated.id];
        return next;
      }
      next[updated.id] = {
        ...(next[updated.id] || {}),
        ...Object.fromEntries(changedFields.map((field) => [field, true])),
      };
      return next;
    });
    return updated;
  }, [filters, updateTransaction]);

  useEffect(() => {
    if (!rawDataPopover) {
      return undefined;
    }

    function handlePointerDown(event) {
      const popover = rawDataPopoverRef.current;
      const eventPath = event.composedPath?.() || [];
      const clickedPopover = popover && (popover.contains(event.target) || eventPath.includes(popover));
      if (!clickedPopover) {
        setRawDataPopover(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setRawDataPopover(null);
      }
    }

    function closePopover() {
      setRawDataPopover(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closePopover);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closePopover);
    };
  }, [rawDataPopover]);

  const toggleRawDataPopover = useCallback((row, rawData, button) => {
    const mappingId = accountMappingLookup.get(row?.account_id || row?.bank_account?.id || "");
    const mapping = mappingLookup.get(mappingId);
    const entries = rawDataEntries(rawData, hideAmounts, categorizationRawDataKeys(mapping));
    if (!entries.length) {
      setRawDataPopover(null);
      return;
    }
    setRawDataPopover((current) => {
      if (current?.rowId === row?.id) {
        return null;
      }
      return {
        entries,
        position: rawDataPopoverPosition(button.getBoundingClientRect()),
        rowId: row?.id,
      };
    });
  }, [accountMappingLookup, hideAmounts, mappingLookup]);

  const columnDefs = useMemo(() => [
    {
      cellClass: "raw-data-grid-cell",
      cellRenderer: (params) => (
        <RawDataButton
          onToggle={(button) => toggleRawDataPopover(params.data, params.value, button)}
          rawData={params.value}
        />
      ),
      field: "raw_data",
      headerName: "",
      resizable: false,
      sortable: false,
      width: 52,
    },
    { field: "transaction_date", headerName: "Date", width: 120, initialSort: "desc" },
    { field: "description", headerName: "Description", flex: 2, minWidth: 260, wrapText: true, autoHeight: true },
    {
      cellClass: (params) => (Number(params.value) >= 0 ? "amount-income" : "amount-expense"),
      field: "converted_amount",
      headerName: "Amount",
      valueFormatter: (params) => (
        params.value === null || params.value === undefined
          ? "Missing rate"
          : formatAmountWithCurrency(params.value, params.data?.converted_currency || defaultCurrency, hideAmounts)
      ),
      width: 150,
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
      cellEditor: SubcategorySelectEditor,
      cellEditorParams: { options: subcategoryOptions },
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
      cellClass: (params) => retainedCellClass(params, `editable-cell ${!params.value ? "muted-cell" : ""}`),
      tooltipValueGetter: retainedCellTooltip,
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
      cellClass: (params) => retainedCellClass(params, `editable-cell ${!params.value ? "muted-cell" : ""}`),
      tooltipValueGetter: retainedCellTooltip,
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
          updateTransaction={saveTransaction}
        />
      ),
      valueFormatter: (params) => (params.value || []).map((tag) => tag.name).join(", ") || "No tags",
      cellClass: retainedCellClass,
      tooltipValueGetter: retainedCellTooltip,
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
              await saveTransaction(params.data, { is_ignored: event.target.checked });
              notify("Transaction saved");
            } catch (error) {
              notify(error.message);
            }
          }}
          type="checkbox"
        />
      ),
      cellClass: retainedCellClass,
      tooltipValueGetter: retainedCellTooltip,
      width: 110,
    },
    {
      cellClass: (params) => retainedCellClass(params, "lock-cell"),
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
                await saveTransaction(params.data, { is_categorization_locked: !locked });
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
      tooltipValueGetter: retainedCellTooltip,
      width: 96,
    },
  ], [accountLookup, categoryLookup, defaultCurrency, hideAmounts, notify, refs.tags, retainedCellClass, retainedCellTooltip, saveTransaction, subcategoryLookup, subcategoryOptions, toggleRawDataPopover]);

  async function onCellValueChanged(event) {
    if (event.oldValue === event.newValue || !["subcategory_id", "want_need_investment"].includes(event.colDef.field)) {
      return;
    }
    const patch = event.colDef.field === "subcategory_id"
      ? { subcategory_id: event.newValue || "" }
      : { want_need_investment: event.newValue || "" };
    try {
      await saveTransaction(event.data, patch);
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
        getRowId={(params) => params.data.id}
        onCellValueChanged={onCellValueChanged}
        rowData={rowData}
        rowHeight={48}
        stopEditingWhenCellsLoseFocus
        suppressScrollOnNewData
        theme={transactionGridTheme}
        tooltipShowDelay={250}
      />
      {rawDataPopover && (
        <RawDataPopover
          entries={rawDataPopover.entries}
          position={rawDataPopover.position}
          ref={rawDataPopoverRef}
        />
      )}
    </div>
  );
}

function SubcategorySelectEditor({ onKeyDown, onValueChange, options = [], stopEditing, value }) {
  const selectRef = useRef(null);
  const currentValue = value || "";

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  return (
    <select
      className="ag-cell-edit-select"
      onChange={(event) => {
        onValueChange?.(event.target.value);
        stopEditing?.();
      }}
      onKeyDown={(event) => onKeyDown?.(event.nativeEvent)}
      ref={selectRef}
      value={currentValue}
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue || "unassigned"} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

function changedTransactionCellFields(patch) {
  const fields = [];
  if (Object.prototype.hasOwnProperty.call(patch, "subcategory_id")) {
    fields.push("subcategory_id");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "want_need_investment")) {
    fields.push("want_need_investment");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "tag_ids")) {
    fields.push("tags");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "is_ignored")) {
    fields.push("is_ignored");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "is_categorization_locked")) {
    fields.push("is_categorization_locked");
  }
  return fields;
}

function transactionMatchesCurrentFilters(row, filters = {}) {
  if (!row) {
    return false;
  }
  if (!filters.include_ignored && row.is_ignored) {
    return false;
  }
  if (!filters.include_locked && row.is_categorization_locked) {
    return false;
  }
  if (filters.date_from && (!row.transaction_date || row.transaction_date < filters.date_from)) {
    return false;
  }
  if (filters.date_to && (!row.transaction_date || row.transaction_date > filters.date_to)) {
    return false;
  }
  if (!checklistSelectionMatches(filters.direction, row.direction || "")) {
    return false;
  }
  if (!checklistSelectionMatches(filters.bank_account, row.bank_account?.id || "")) {
    return false;
  }
  if (!checklistSelectionMatches(filters.category, row.category?.id || UNASSIGNED)) {
    return false;
  }
  if (!checklistSelectionMatches(filters.subcategory, row.subcategory?.id || UNASSIGNED)) {
    return false;
  }
  if (!checklistSelectionMatches(filters.want_need_investment, row.want_need_investment || UNASSIGNED)) {
    return false;
  }
  if (!tagSelectionMatches(filters.tag, row.tags || [])) {
    return false;
  }
  if (!transactionSearchMatches(row, filters.q)) {
    return false;
  }
  return true;
}

function checklistSelectionMatches(selection, value) {
  if (!Array.isArray(selection)) {
    return true;
  }
  return selection.length > 0 && selection.includes(value);
}

function tagSelectionMatches(selection, tags) {
  if (!Array.isArray(selection)) {
    return true;
  }
  if (!selection.length) {
    return false;
  }
  if (!tags.length) {
    return selection.includes(UNASSIGNED);
  }
  return tags.some((tag) => selection.includes(tag.id));
}

function transactionSearchMatches(row, query) {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) {
    return true;
  }
  const rawDataValues = row.raw_data && typeof row.raw_data === "object"
    ? Object.values(row.raw_data)
    : [];
  const searchableText = [
    row.description,
    row.counterparty_name,
    row.counterparty_account_number,
    row.transaction_type,
    ...rawDataValues,
  ].map((value) => normalizeName(value)).join(" ");
  return searchableText.includes(normalizedQuery);
}

function joinClassNames(...classNames) {
  return classNames.filter(Boolean).join(" ");
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
  const monthlyHoverData = monthlyRows.map((row) => [
    formatMoneyValue(row.income, hideAmounts),
    formatMoneyValue(row.expense, hideAmounts),
    formatMoneyValue(row.net, hideAmounts),
  ]);
  const barWidth = monthlyRows.map(() => 0.78);
  const netColors = monthlyRows.map(() => cssVar("--net-overlay", "rgba(230, 237, 243, 0.26)"));
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[
        {
          customdata: monthlyHoverData,
          hovertemplate: "Incomes: %{customdata[0]}<extra></extra>",
          marker: { color: cssVar("--green", "#2f8f65") },
          name: "Incomes",
          type: "bar",
          width: barWidth,
          x: months,
          y: incomes,
        },
        {
          customdata: monthlyHoverData,
          hovertemplate: "Expenses: %{customdata[1]}<extra></extra>",
          marker: { color: cssVar("--red", "#dc2626") },
          name: "Expenses",
          type: "bar",
          width: barWidth,
          x: months,
          y: expenses,
        },
        {
          customdata: monthlyHoverData,
          hovertemplate: "Net: %{customdata[2]}<extra></extra>",
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
  const topExpenseHoverData = topRows.map((row) => formatMoneyValue(row.amount, hideAmounts));
  return (
    <Plot
      config={{ displaylogo: false, responsive: true }}
      data={[{
        customdata: topExpenseHoverData,
        marker: { color: cssVar("--blue", "#58a6ff") },
        orientation: "h",
        hovertemplate: hideAmounts ? "%{y}<extra></extra>" : "%{y}<br>Amount: %{customdata}<extra></extra>",
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
      <div className="metric-value">{formatCount(count)}</div>
      {hasDetails ? (
        <details className="metric-details">
          <summary>{formatCount(detailCount)} details</summary>
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
        <span className="muted">+{formatCount(ids.length - visibleIds.length)} more</span>
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
        <span className="muted">+{formatCount(transactions.length - visibleTransactions.length)} more</span>
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
        <div className="muted">+{formatCount(details.length - visibleDetails.length)} more conflicts</div>
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
  const [count, setCount] = useState("");
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
            <button className="saved-filter-load-button" disabled={busy} onClick={() => onLoad(preset)} type="button">
              <span>{preset.name}</span>
              <small>{formatCount(countActiveFilters(preset.filters))} filters</small>
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

function RawDataButton({ onToggle, rawData }) {
  const buttonRef = useRef(null);
  const hasEntries = rawData && typeof rawData === "object" && Object.keys(rawData).length > 0;

  function stopGridEvent(event) {
    event.stopPropagation();
  }

  function togglePopover(event) {
    event.stopPropagation();
    if (buttonRef.current) {
      onToggle(buttonRef.current);
    }
  }

  return (
    <div className="raw-data-cell-inner" onClick={stopGridEvent} onDoubleClick={stopGridEvent} onMouseDown={stopGridEvent} onPointerDown={stopGridEvent}>
      <button
        aria-haspopup="dialog"
        aria-label={hasEntries ? "Show original transaction data" : "No original transaction data saved"}
        className="raw-data-button"
        disabled={!hasEntries}
        onClick={togglePopover}
        ref={buttonRef}
        title={hasEntries ? "Show original data" : "No original data saved"}
        type="button"
      >
        <InfoIcon />
      </button>
    </div>
  );
}

const RawDataPopover = forwardRef(function RawDataPopover({ entries, position }, ref) {
  function stopGridEvent(event) {
    event.stopPropagation();
  }

  return (
    <div
      className="raw-data-popover"
      onClick={stopGridEvent}
      onDoubleClick={stopGridEvent}
      onMouseDown={stopGridEvent}
      onPointerDown={stopGridEvent}
      ref={ref}
      role="dialog"
      style={{ left: position.left, top: position.top }}
    >
      <div className="raw-data-popover-header">
        <strong>Original Data</strong>
        <span>{formatCount(entries.length)} fields</span>
      </div>
      <dl className="raw-data-list">
        {entries.map((entry) => (
          <div className={`raw-data-row ${entry.isCategorizationField ? "is-categorization-field" : ""}`.trim()} key={entry.key}>
            <dt className="raw-data-key">
              <span>{entry.key}</span>
              {entry.isCategorizationField ? <span className="raw-data-badge">Categorization</span> : null}
            </dt>
            <dd className="raw-data-value">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});

function rawDataPopoverPosition(rect) {
  const popoverWidth = 460;
  const popoverHeight = 420;
  const left = Math.min(
    Math.max(12, rect.left),
    Math.max(12, window.innerWidth - popoverWidth - 12),
  );
  const preferredTop = rect.bottom + 6;
  const top = preferredTop + popoverHeight > window.innerHeight && rect.top > popoverHeight
    ? rect.top - popoverHeight - 6
    : preferredTop;
  return { left, top: Math.max(12, top) };
}

function rawDataEntries(rawData, hideAmounts, highlightedKeys = new Set()) {
  if (!rawData || typeof rawData !== "object") {
    return [];
  }
  const entries = Array.isArray(rawData)
    ? rawData.map((value, index) => [`Item ${index + 1}`, value])
    : Object.entries(rawData);
  return entries.map(([key, value]) => ({
    isCategorizationField: highlightedKeys.has(String(key)),
    key: String(key),
    value: formatRawDataValue(key, value, hideAmounts),
  }));
}

function categorizationRawDataKeys(mapping) {
  const highlightedKeys = new Set();
  if (!mapping?.column_map || !Array.isArray(mapping.categorization_fields)) {
    return highlightedKeys;
  }
  mapping.categorization_fields.forEach((field) => {
    coerceRawDataColumns(mapping.column_map[field]).forEach((column) => {
      if (column) {
        highlightedKeys.add(column);
      }
    });
  });
  return highlightedKeys;
}

function coerceRawDataColumns(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.map((item) => String(item)) : [String(value)];
}

function formatRawDataValue(key, value, hideAmounts) {
  if (hideAmounts && rawDataFieldLooksMonetary(key)) {
    return "--";
  }
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function rawDataFieldLooksMonetary(key) {
  const words = String(key || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const wordTerms = new Set([
    "amount",
    "amt",
    "balance",
    "castka",
    "credit",
    "debit",
    "expense",
    "income",
    "price",
    "sum",
    "suma",
    "total",
    "zustatek",
  ]);
  if (words.some((word) => wordTerms.has(word))) {
    return true;
  }
  const normalized = normalizeName(key);
  return ["amount", "balance", "castka", "expense", "income", "price", "suma", "total", "zustatek"]
    .some((term) => normalized.includes(term));
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
      setPopoverPosition(tagPopoverPosition(rect));
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
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPopoverPosition(tagPopoverPosition(rect));
    }
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
      {isOpen && createPortal(
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
                <span className="tag-option-check">{selectedSet.has(tag.id) ? "\u2713" : ""}</span>
                <span className="pill tag-pill" style={colorPillStyle(tag.color)}>{tag.name}</span>
              </button>
            )) : <div className="tag-no-matches">No matches</div>}
          </div>
          <div className="tag-popover-actions">
            <button className="link-button" disabled={saving} onClick={() => setIsOpen(false)} type="button">Cancel</button>
            <LoadingButton busy={saving} busyLabel="Applying" className="primary-action" onClick={applyTags} type="button">Apply</LoadingButton>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function tagPopoverPosition(rect) {
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
  return { left, top: Math.max(12, top) };
}

function TagCloud({ collapse = true, tags }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);
  const visibleTags = tags.slice(0, visibleCount);
  const hiddenCount = Math.max(tags.length - visibleCount, 0);

  useLayoutEffect(() => {
    if (!collapse) {
      setVisibleCount(tags.length);
      return undefined;
    }
    const element = containerRef.current;
    const measureElement = measureRef.current;
    if (!element) {
      return undefined;
    }

    function updateVisibleCount() {
      if (!tags.length) {
        setVisibleCount(0);
        return;
      }
      if (!measureElement) {
        setVisibleCount(Math.min(tags.length, 2));
        return;
      }
      setVisibleCount(measureVisibleTagCount(
        tags,
        element.clientWidth,
        measureElement,
      ));
    }
    updateVisibleCount();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateVisibleCount);
      return () => window.removeEventListener("resize", updateVisibleCount);
    }
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapse, tags]);

  const className = `tag-cloud ${collapse ? "tag-cloud-collapsed" : "tag-cloud-expanded"}`;

  return (
    <div className={className} ref={containerRef} title={tagTitle(tags)}>
      {visibleTags.map((tag) => <span className="pill tag-pill" key={tag.id} style={colorPillStyle(tag.color)}>{tag.name}</span>)}
      {hiddenCount > 0 && <span className="pill tag-more-pill">+{hiddenCount}</span>}
      {collapse && tags.length ? (
        <div aria-hidden="true" className="tag-cloud-measure" ref={measureRef}>
          {tags.map((tag) => (
            <span className="pill tag-pill" data-tag-measure="tag" key={tag.id} style={colorPillStyle(tag.color)}>{tag.name}</span>
          ))}
          <span className="pill tag-more-pill" data-tag-measure="more">+{tags.length}</span>
        </div>
      ) : null}
    </div>
  );
}

function measureVisibleTagCount(tags, width, measureElement) {
  if (!tags.length) {
    return 0;
  }
  if (!width) {
    return Math.min(tags.length, 2);
  }
  const tagElements = Array.from(measureElement.querySelectorAll("[data-tag-measure='tag']"));
  const moreElement = measureElement.querySelector("[data-tag-measure='more']");
  const tagWidths = tagElements.map((element, index) => element.offsetWidth || estimateFallbackTagWidth(tags[index]?.name));
  const moreWidth = moreElement?.offsetWidth || 42;
  const gap = 4;
  let usedWidth = 0;
  let visible = 0;

  for (const tagWidth of tagWidths) {
    const nextWidth = usedWidth + (visible ? gap : 0) + tagWidth;
    const hasHiddenAfterThis = visible + 1 < tags.length;
    const reserveWidth = hasHiddenAfterThis ? gap + moreWidth : 0;
    if (nextWidth + reserveWidth > width) {
      break;
    }
    usedWidth = nextWidth;
    visible += 1;
  }
  return Math.max(visible, 1);
}

function estimateFallbackTagWidth(label) {
  return Math.min(150, Math.max(42, String(label || "").length * 7 + 24));
}
