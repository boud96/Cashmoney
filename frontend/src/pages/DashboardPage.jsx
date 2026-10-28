import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiGet, apiPost } from "../api.js";
import { Tabs, tabPanelProps } from "../components.jsx";
import {
  UNASSIGNED,
  buildTotals,
  cloneFilters,
  countActiveFilters,
  emptyFilters,
  formatCount,
  getStoredFilterPresets,
  initialChecklistFilters,
  normalizeTagSelection,
  offeredSubcategories,
  storeFilterPresets,
  subLabel,
  wniOptions,
} from "../shared.js";
import {
  BulkAssignMultiModal,
  CLEAR_BULK_VALUE,
  InternalTransferReviewPanel,
  NO_BULK_CHANGE,
  RecategorizeModal,
  RecategorizeStats,
  UncategorizedReviewPanel,
  emptyBulkAssignDraft,
  emptyKeywordDraft,
  keywordDraftFromSuggestion,
  textLines,
} from "./dashboard/ActionDialogs.jsx";
import { FilterBar } from "./dashboard/FilterBar.jsx";
import { ChartPanel, MonthlyChart, SunburstChart, TopExpenseChart, WniChart } from "./dashboard/OverviewCharts.jsx";
import { TotalsRow } from "./dashboard/TotalsRow.jsx";
import { TransactionGrid } from "./dashboard/TransactionGrid.jsx";
import { TransactionToolbar } from "./dashboard/TransactionToolbar.jsx";

export default function DashboardPage({
  confirmAction,
  dashboardTab,
  deleteTransaction,
  filterDefaults,
  filters,
  filterParams,
  hideAmounts,
  importBusy,
  notify,
  onDashboardTabChange,
  onFilterChange,
  recategorizeResult,
  refs,
  reloadAll,
  reloadDashboard,
  setFilters,
  setRecategorizeResult,
  summary,
  summaryBusy = false,
  transactionPage,
  transactionsBusy = false,
  updateTransaction,
}) {
  const defaultCurrency = summary?.default_currency || refs.settings?.default_currency || "CZK";
  const totals = useMemo(
    () => buildTotals(summary, hideAmounts, defaultCurrency),
    [defaultCurrency, hideAmounts, summary],
  );
  // From the summary, so the totals, the tab and the actions don't wait for the list.
  const filteredCount = summary?.transaction_count ?? transactionPage.count ?? 0;
  const loadedTransactionCount = transactionPage.results?.length || 0;
  const filteredTransactionCount = transactionPage.count || 0;
  const transactionsAreCapped = loadedTransactionCount > 0 && filteredTransactionCount > loadedTransactionCount;
  const transactionCountLabel = transactionsAreCapped
    ? `${formatCount(loadedTransactionCount)} of ${formatCount(filteredTransactionCount)} shown`
    : `${formatCount(filteredTransactionCount)} shown`;
  const conflictIds = useMemo(
    () => new Set(recategorizeResult?.conflict_transaction_ids || []),
    [recategorizeResult],
  );
  const [bulkAssignEditorOpen, setBulkAssignEditorOpen] = useState(false);
  const [bulkAssignDraft, setBulkAssignDraft] = useState(emptyBulkAssignDraft);
  const [bulkAssignBusy, setBulkAssignBusy] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
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
  const [transferView, setTransferView] = useState("candidates");
  const [transferMatches, setTransferMatches] = useState({ count: 0, matches: [] });
  const [transferMatchesLoading, setTransferMatchesLoading] = useState(false);
  const [unmatchingTransferId, setUnmatchingTransferId] = useState("");
  const localFilterPresetsMigrated = useRef(false);
  const activeFilterCount = useMemo(
    () => countActiveFilters(filters, refs, filterDefaults),
    [filterDefaults, filters, refs],
  );
  const subcategoryFilterOptions = useMemo(() => {
    const offered = offeredSubcategories(filters.category, refs.subcategories);
    return [
      ...(offered.unassigned ? [[UNASSIGNED, "Unassigned subcategory"]] : []),
      ...offered.items.map((item) => [item.id, subLabel(item)]),
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
    const presetFilters = cloneFilters(preset.filters);
    setFilters((current) => ({
      ...current,
      ...presetFilters,
      tag: normalizeTagSelection(presetFilters.tag, refs.tags),
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

  // Back to the filters the app starts with: everything offered, any tag, the full date
  // range, no search, the default View options.
  function clearFilters() {
    setRecategorizeResult(null);
    setFilters({
      ...emptyFilters(),
      ...initialChecklistFilters(refs),
      date_from: filterDefaults.from,
      date_to: filterDefaults.to,
    });
  }

  function openUncategorizedReview() {
    setUncategorizedReviewError("");
    setUncategorizedReviewOpen(true);
  }

  function openRecategorizeModal() {
    if (!filteredCount) {
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
    if (!filteredCount) {
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

  const loadTransferMatches = useCallback(async () => {
    setTransferMatchesLoading(true);
    setTransferError("");
    try {
      // Matched transfers are ignored and locked, so include those rows in the scope.
      const payload = await apiGet("/transactions/internal-transfers/matches/", {
        ...filterParams,
        include_ignored: "true",
        include_locked: "true",
      });
      setTransferMatches({ count: payload.count || 0, matches: payload.matches || [] });
    } catch (error) {
      setTransferError(error.message);
      notify(error.message);
    } finally {
      setTransferMatchesLoading(false);
    }
  }, [filterParams, notify]);

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

  useEffect(() => {
    if (transferReviewOpen && transferView === "matched") {
      loadTransferMatches();
    }
  }, [loadTransferMatches, transferReviewOpen, transferView]);

  function openTransferReview() {
    setTransferError("");
    setTransferView("candidates");
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

  async function unmatchTransfer(match) {
    const confirmed = await confirmAction({
      confirmLabel: "Unmatch",
      message: match.restorable
        ? "Unmatch this transfer?\n\nBoth transactions get back the ignored, locked and subcategory values they had before the match, except anything you have changed since."
        : "Unmatch this transfer?\n\nIt was matched before Cashmoney kept the earlier values, so both transactions are unlocked, stop being ignored, and are recategorized by your keyword rules.",
      title: "Unmatch transfer",
    });
    if (!confirmed) {
      return;
    }
    setUnmatchingTransferId(match.id);
    try {
      await apiDelete(`/transactions/internal-transfers/matches/${match.id}/`);
      notify("Transfer unmatched");
      await Promise.all([reloadDashboard(), loadTransferMatches(), loadTransferCandidates()]);
    } catch (error) {
      notify(error.message);
    } finally {
      setUnmatchingTransferId("");
    }
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
      notify(
        result.skipped
          ? `${formatCount(result.created)} transfer pairs applied, ${formatCount(result.skipped)} skipped because they were already matched or no longer qualify`
          : `${formatCount(result.created)} transfer pairs applied`
      );
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

  async function deleteFilteredTransactions() {
    setBulkDeleting(true);
    try {
      const impact = await apiGet("/transactions/bulk-delete/", filterParams);
      if (!impact.count) {
        notify("No transactions match the current filters");
        return;
      }
      const confirmed = await confirmAction({
        confirmLabel: "Delete",
        danger: true,
        message: [
          `Delete ${formatCount(impact.count)} ${impact.count === 1 ? "transaction" : "transactions"} matching the current filters?`,
          ...(impact.effects || []),
          "This can't be undone. Importing their files again would bring them back.",
        ].join("\n\n"),
        title: "Delete transactions",
      });
      if (!confirmed) {
        return;
      }
      const result = await apiPost("/transactions/bulk-delete/", { expected_count: impact.count }, filterParams);
      notify(`${formatCount(result.deleted)} ${result.deleted === 1 ? "transaction" : "transactions"} deleted`);
      await reloadDashboard();
    } catch (error) {
      notify(error.message);
    } finally {
      setBulkDeleting(false);
    }
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
      <FilterBar
        activeFilterCount={activeFilterCount}
        filterDefaults={filterDefaults}
        filters={filters}
        onClearFilters={clearFilters}
        onFilterChange={onFilterChange}
        presets={{
          busy: savedFiltersBusy,
          items: savedFilters,
          name: savedFilterName,
          onDelete: deleteFilterPreset,
          onLoad: loadFilterPreset,
          onNameChange: setSavedFilterName,
          onSave: saveCurrentFilterPreset,
        }}
        refs={refs}
        setFilters={setFilters}
        subcategoryOptions={subcategoryFilterOptions}
      />

      <TotalsRow busy={summaryBusy} onReview={openUncategorizedReview} reviewDisabled={importBusy} totals={totals} />
      {summary?.missing_conversions ? (
        <div className="dashboard-warning">
          {formatCount(summary.missing_conversions)} filtered transactions are missing exchange rates and are excluded from converted totals.
        </div>
      ) : null}

      <div className="dashboard-tab-row">
        <Tabs
          idPrefix="dashboard"
          label="Dashboard view"
          onChange={onDashboardTabChange}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "transactions", label: "Transactions", badge: summary ? formatCount(summary.transaction_count) : "" },
          ]}
          value={dashboardTab}
        />
        {dashboardTab === "transactions" ? (
          <TransactionToolbar
            actionsDisabled={!filteredCount || importBusy}
            busy={transactionsBusy}
            countLabel={transactionCountLabel}
            deleting={bulkDeleting}
            findingTransfers={transferLoading && transferReviewOpen}
            loadingReview={uncategorizedSuggestionsLoading && uncategorizedReviewOpen}
            onBulkAssign={openBulkAssignEditor}
            onDelete={deleteFilteredTransactions}
            onFindTransfers={openTransferReview}
            onRecategorize={openRecategorizeModal}
            onReview={openUncategorizedReview}
            recategorizing={recategorizing}
            reviewDisabled={importBusy}
          />
        ) : null}
      </div>

      {dashboardTab === "overview" ? (
        <div className="dashboard-tab-panel" {...tabPanelProps("dashboard", "overview")}>
          <div className="dashboard-charts">
            <ChartPanel className="chart-panel-wide" ready={Boolean(summary)} title="Monthly Flow"><MonthlyChart hideAmounts={hideAmounts} rows={summary?.monthly || []} /></ChartPanel>
            <ChartPanel ready={Boolean(summary)} title="Income Categories"><SunburstChart hideAmounts={hideAmounts} rows={summary?.income_categories || []} /></ChartPanel>
            <ChartPanel ready={Boolean(summary)} title="Expense Categories"><SunburstChart hideAmounts={hideAmounts} rows={summary?.expense_categories || []} /></ChartPanel>
            <ChartPanel ready={Boolean(summary)} title="Want / Need / Investment"><WniChart hideAmounts={hideAmounts} rows={summary?.want_need_investment || []} /></ChartPanel>
            <ChartPanel ready={Boolean(summary)} title="Top Expense Subcategories"><TopExpenseChart hideAmounts={hideAmounts} rows={summary?.expense_categories || []} /></ChartPanel>
          </div>
        </div>
      ) : (
        <div className="dashboard-tab-panel" {...tabPanelProps("dashboard", "transactions")}>
          {recategorizeResult && <RecategorizeStats result={recategorizeResult} />}
          {transactionsAreCapped ? (
            <div className="transaction-cap-warning">
              Showing the newest {formatCount(loadedTransactionCount)} of {formatCount(filteredTransactionCount)} filtered transactions.
              Older matching transactions are omitted from the table. Totals and charts still use the full filtered set.
            </div>
          ) : null}
          <TransactionGrid confirmAction={confirmAction} conflictIds={conflictIds} defaultCurrency={defaultCurrency} deleteTransaction={deleteTransaction} filterParams={filterParams} hideAmounts={hideAmounts} notify={notify} refs={refs} rows={transactionPage.results} updateTransaction={updateTransaction} />
        </div>
      )}

      {recategorizeModalOpen && (
        <RecategorizeModal
          busy={recategorizing}
          count={filteredCount}
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
          matches={transferMatches}
          matchesBusy={transferMatchesLoading}
          meta={transferMeta}
          onApply={applySelectedTransfers}
          onUnmatch={unmatchTransfer}
          onViewChange={setTransferView}
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
          unmatchingId={unmatchingTransferId}
          view={transferView}
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
          count={filteredCount}
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
    </>
  );
}
