// The dashboard's transaction table: columns, cell editors and renderers, the raw-data and tag popovers.
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  CustomEditorModule,
  LocaleModule,
  ModuleRegistry,
  SelectEditorModule,
  themeQuartz,
  TooltipModule,
} from "ag-grid-community";

import { apiGet } from "../../api.js";
import { DotLabel, LoadingButton, Spinner, useFillHeight } from "../../components.jsx";
import {
  colorPillStyle,
  compareAmounts,
  formatAmountValue,
  formatAmountWithCurrency,
  normalizeName,
  pluralize,
  subLabel,
  tagTitle,
  titleCase,
  wniColor,
} from "../../shared.js";
import { InfoIcon, LockIcon, TrashIcon, WarningIcon } from "../../icons.jsx";

// Only the grid features this page uses (CR-30). A missing module can fail silently,
// so after changing a grid, register ValidationModule while checking it: it names
// every option whose module is missing.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CellStyleModule,  // cellClass
  TooltipModule,  // tooltipValueGetter
  CustomEditorModule,  // the subcategory editor
  SelectEditorModule,  // agSelectCellEditor for Want/Need/Investment
  LocaleModule,  // localeText: the empty and loading messages
]);

// The grid's own messages, in the app's words.
const transactionGridText = { loadingOoo: "Loading…", noRowsToShow: "No transactions match the filters" };

// One-line rows in a smaller font, so about 20 rows fit and every column fits at 1440 px.
const transactionGridTheme = themeQuartz
  .withParams({ cellHorizontalPaddingScale: 0.6, fontSize: 13, headerFontSize: 12.5 })
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

const FILTER_RETAINED_TOOLTIP = "Saved value no longer matches the current filters, so this row is kept visible temporarily.";

export function TransactionGrid({ confirmAction, conflictIds, defaultCurrency, deleteTransaction, filterParams, hideAmounts, loading = false, notify, refs, rows, updateTransaction }) {
  const [rawDataPopover, setRawDataPopover] = useState(null);
  const gridRef = useRef(null);
  useFillHeight(gridRef, { min: 360 });
  const [rawDataLoadingId, setRawDataLoadingId] = useState("");
  const [filterRetainedCells, setFilterRetainedCells] = useState({});
  const rawDataCacheRef = useRef(new Map());
  const rawDataPopoverRef = useRef(null);
  const subcategoryOptions = useMemo(
    () => [["", "Unassigned"], ...refs.subcategories.map((item) => [item.id, subLabel(item)])],
    [refs.subcategories],
  );
  const subcategoryLookup = useMemo(() => new Map(refs.subcategories.map((item) => [item.id, item])), [refs.subcategories]);
  const categoryLookup = useMemo(() => new Map(refs.categories.map((item) => [item.id, item])), [refs.categories]);
  const accountLookup = useMemo(() => new Map(refs.accounts.map((item) => [item.id, item.name])), [refs.accounts]);

  const rowData = useMemo(() => rows.map((row) => ({
    ...row,
    account_id: row.bank_account?.id || "",
    categorization_conflict: conflictIds.has(row.id),
    subcategory_id: row.subcategory?.id || "",
  })), [conflictIds, rows]);

  // Rows kept visible after an edit took them out of the filters clear when the filters change.
  useEffect(() => {
    setFilterRetainedCells({});
  }, [filterParams]);

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
    const isRetainedByEdit = changedFields.length > 0 && updated.matches_filters === false;
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
  }, [updateTransaction]);

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

  const toggleRawDataPopover = useCallback(async (row, button) => {
    if (!row?.id || !row.has_raw_data) {
      setRawDataPopover(null);
      return;
    }
    if (rawDataPopover?.rowId === row.id) {
      setRawDataPopover(null);
      return;
    }
    const position = rawDataPopoverPosition(button.getBoundingClientRect());
    let rawDataPayload = rawDataCacheRef.current.get(row.id);
    if (!rawDataPayload) {
      setRawDataLoadingId(row.id);
      try {
        rawDataPayload = await apiGet(`/transactions/${row.id}/raw-data/`);
        rawDataCacheRef.current.set(row.id, rawDataPayload);
      } catch (error) {
        notify(error.message);
        return;
      } finally {
        setRawDataLoadingId((current) => (current === row.id ? "" : current));
      }
    }
    const entries = rawDataEntries(
      rawDataPayload.raw_data,
      hideAmounts,
      new Set(rawDataPayload.categorization_keys || []),
    );
    if (!entries.length) {
      setRawDataPopover(null);
      return;
    }
    setRawDataPopover({
      entries,
      position,
      rowId: row.id,
    });
  }, [hideAmounts, notify, rawDataPopover]);

  const removeTransaction = useCallback(async (row) => {
    try {
      const impact = await apiGet(`/transactions/${row.id}/delete-impact/`);
      const confirmed = await confirmAction({
        confirmLabel: "Delete",
        danger: true,
        message: [
          `Delete "${row.description || "this transaction"}" from ${row.transaction_date}?`,
          ...(impact.effects || []),
          "This can't be undone. Importing its file again would bring it back.",
        ].join("\n\n"),
        title: "Delete transaction",
      });
      if (!confirmed) {
        return;
      }
      await deleteTransaction(row);
      notify("Transaction deleted");
    } catch (error) {
      notify(error.message);
    }
  }, [confirmAction, deleteTransaction, notify]);

  const columnDefs = useMemo(() => [
    {
      cellClass: "raw-data-grid-cell",
      cellRenderer: (params) => (
        <RawDataButton
          hasRawData={Boolean(params.data?.has_raw_data)}
          loading={rawDataLoadingId === params.data?.id}
          onToggle={(button) => toggleRawDataPopover(params.data, button)}
        />
      ),
      field: "has_raw_data",
      headerName: "",
      resizable: false,
      sortable: false,
      width: 32,
    },
    { field: "transaction_date", headerName: "Date", width: 90, initialSort: "desc" },
    { field: "description", headerName: "Description", flex: 1, minWidth: 220, tooltipField: "description" },
    {
      cellClass: (params) => `amount-column ${Number(params.value) >= 0 ? "amount-income" : "amount-expense"}`,
      cellRenderer: (params) => <AmountCell data={params.data} hideAmounts={hideAmounts} text={params.valueFormatted} />,
      comparator: compareAmounts,
      field: "converted_amount",
      headerClass: "amount-header",
      // The column names the currency; each row shows just the number.
      headerName: `Amount (${defaultCurrency})`,
      valueFormatter: (params) => (
        params.value === null || params.value === undefined
          ? "Missing rate"
          : formatAmountValue(params.value, hideAmounts)
      ),
      width: 108,
    },
    {
      field: "account_id",
      headerName: "Account",
      tooltipValueGetter: (params) => params.valueFormatted,
      valueFormatter: (params) => accountLookup.get(params.value) || "",
      width: 102,
    },
    {
      field: "category",
      headerName: "Category",
      cellRenderer: (params) => {
        if (params.data?.categorization_conflict) {
          return <ConflictCell />;
        }
        const category = categoryLookup.get(params.value?.id);
        return <DotLabel color={category?.color} label={params.value?.name || "Unassigned"} muted={!params.value} />;
      },
      valueFormatter: (params) => params.value?.name || "Unassigned",
      cellClass: (params) => (!params.value ? "muted-cell" : ""),
      tooltipValueGetter: (params) => params.valueFormatted,
      width: 100,
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
        return <DotLabel color={subcategory?.color} label={subcategory?.name || "Unassigned"} muted={!subcategory} />;
      },
      valueFormatter: (params) => {
        const subcategory = subcategoryLookup.get(params.value);
        return subcategory?.name || "Unassigned";
      },
      cellClass: (params) => retainedCellClass(params, `editable-cell ${!params.value ? "muted-cell" : ""}`),
      tooltipValueGetter: (params) => retainedCellTooltip(params) || params.valueFormatted,
      width: 116,
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
      width: 88,
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
      valueFormatter: (params) => (params.value || []).map((tag) => tag.name).join(", ") || "Untagged",
      cellClass: retainedCellClass,
      tooltipValueGetter: retainedCellTooltip,
      sortable: false,
      width: 78,
    },
    {
      field: "is_ignored",
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
      width: 70,
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
      width: 64,
    },
    {
      cellClass: "lock-cell",
      cellRenderer: (params) => (
        <button
          aria-label="Delete transaction"
          className="lock-cell-button delete-cell-button"
          onClick={(event) => {
            event.stopPropagation();
            removeTransaction(params.data);
          }}
          title="Delete transaction"
          type="button"
        >
          <TrashIcon />
        </button>
      ),
      colId: "delete",
      headerName: "",
      resizable: false,
      sortable: false,
      width: 32,
    },
  ], [accountLookup, categoryLookup, defaultCurrency, hideAmounts, notify, rawDataLoadingId, refs.tags, removeTransaction, retainedCellClass, retainedCellTooltip, saveTransaction, subcategoryLookup, subcategoryOptions, toggleRawDataPopover]);

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
    <div className="transaction-grid" ref={gridRef}>
      <AgGridReact
        columnDefs={columnDefs}
        defaultColDef={{ resizable: true, sortable: true }}
        enableCellTextSelection
        ensureDomOrder
        getRowId={(params) => params.data.id}
        onCellValueChanged={onCellValueChanged}
        headerHeight={34}
        loading={loading}
        localeText={transactionGridText}
        rowData={rowData}
        rowHeight={30}
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

function joinClassNames(...classNames) {
  return classNames.filter(Boolean).join(" ");
}

// The amount in the default currency, right-aligned; a row in another currency shows its
// original amount before it on the same line, with the rate in the tooltip.
function AmountCell({ data, hideAmounts, text }) {
  if (!data?.currency || !data.converted_currency || data.currency === data.converted_currency) {
    return <span className="amount-cell"><span className="amount-value">{text}</span></span>;
  }
  const original = formatAmountWithCurrency(data.amount, data.currency, hideAmounts);
  const rate = Number(data.conversion_rate);
  const rateText = Number.isFinite(rate) && rate > 0
    ? `1 ${data.currency} = ${Number(rate.toFixed(4))} ${data.converted_currency}${data.conversion_rate_date ? ` (rate of ${data.conversion_rate_date})` : ""}`
    : "No exchange rate yet";
  return (
    <span className="amount-cell" title={hideAmounts ? undefined : `Original amount ${original}. ${rateText}.`}>
      <span className="amount-original">{original}</span>
      <span className="amount-value">{text}</span>
    </span>
  );
}

function ConflictCell() {
  return (
    <span className="dot-cell is-conflict">
      <WarningIcon />
      <span className="dot-cell-label">Conflict</span>
    </span>
  );
}

function WniCell({ value }) {
  if (!value) {
    return <DotLabel label="Unassigned" muted />;
  }
  return <DotLabel color={wniColor(value)} label={titleCase(value)} />;
}

function RawDataButton({ hasRawData, loading = false, onToggle }) {
  const buttonRef = useRef(null);

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
        aria-label={hasRawData ? "Show original transaction data" : "No original transaction data saved"}
        className="raw-data-button"
        disabled={!hasRawData || loading}
        onClick={togglePopover}
        ref={buttonRef}
        title={hasRawData ? "Show original data" : "No original data saved"}
        type="button"
      >
        {loading ? <Spinner /> : <InfoIcon />}
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
        <strong>Original data</strong>
        <span>{pluralize(entries.length, "field")}</span>
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
