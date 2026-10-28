export const UNASSIGNED = "__unassigned__";
export const ANY_TAG = "__any__"; // the tag filter's "Tagged": rows with at least one tag
export const NO_SELECTION = "__none__";
export const CHECKLIST_FILTER_KEYS = [
  "bank_account",
  "category",
  "direction",
  "subcategory",
  "want_need_investment",
  "tag",
];
export const OPTIONAL_CHECKLIST_FILTER_KEYS = ["tag"];
export const pages = {
  dashboard: "Dashboard",
  import: "Import",
  settings: "Definitions",
  maintenance: "Maintenance",
  help: "Help",
};
export const THEME_STORAGE_KEY = "cashmoney-theme";
export const ACCENT_STORAGE_KEY = "cashmoney-accent";
export const HIDE_AMOUNTS_STORAGE_KEY = "cashmoney-hide-amounts";
export const FILTER_PRESETS_STORAGE_KEY = "cashmoney-filter-presets";
export const DASHBOARD_TAB_STORAGE_KEY = "cashmoney-dashboard-tab";
export const DEFINITIONS_TAB_STORAGE_KEY = "cashmoney-definitions-tab";
export const HIDDEN_AMOUNT = "----";
export const accentPresets = [
  "#58a6ff",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#d946ef",
  "#8b5cf6",
];
export const wniOptions = [
  ["want", "Want"],
  ["need", "Need"],
  ["investment", "Investment"],
];
export const definitionHelp = {
  "Bank Accounts": "Bank accounts group imported transactions by account, bank, currency, owner count, and optional default import mapping.",
  "Import Mappings": "Import mappings describe how a bank file is read: a CSV layout (separators, date formats, columns) or a camt.053 XML statement, plus the fields used for categorization.",
  Categories: "Categories are the top-level buckets used for dashboard breakdowns and reporting.",
  Subcategories: "Subcategories sit under categories and are the actual category-like value assigned to transactions.",
  Tags: "Tags are optional labels that can be attached to multiple transactions for flexible filtering.",
  Keywords: "Keywords automatically categorize transactions by matching text and assigning subcategory, WNI, tags, or ignored status.",
};
export const mappingFields = [
  ["original_id", "Original ID"],
  ["transaction_date", "Transaction date"],
  ["posted_date", "Posted date"],
  ["description", "Description"],
  ["amount", "Amount"],
  ["currency", "Currency"],
  ["counterparty_name", "Counterparty name"],
  ["counterparty_account_number", "Counterparty account"],
  ["transaction_type", "Transaction type"],
  ["variable_symbol", "Variable symbol"],
  ["specific_symbol", "Specific symbol"],
  ["constant_symbol", "Constant symbol"],
  ["counterparty_note", "Counterparty note"],
  ["my_note", "My note"],
  ["other_note", "Other note"],
];
export const categorizationFieldOptions = mappingFields.filter(
  ([key]) => !["original_id", "transaction_date", "posted_date", "amount", "currency"].includes(key),
);
export const defaultCategorizationFields = categorizationFieldOptions.map(([key]) => key);
export const mappingFileFormats = [
  ["csv", "CSV"],
  ["camt053", "camt.053 XML (ISO 20022)"],
];
export function mappingFileFormatLabel(value) {
  return mappingFileFormats.find(([key]) => key === value)?.[1] || "CSV";
}
export function isStatementFileFormat(value) {
  return Boolean(value) && value !== "csv";
}
export const defaultParsingSettings = {
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
    document.documentElement.setAttribute("data-ag-theme-mode", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.setAttribute("data-ag-theme-mode", "dark");
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

export function emptyFilters() {
  return {
    date_from: "",
    date_to: "",
    bank_account: [],
    category: [],
    direction: [],
    subcategory: [],
    want_need_investment: [],
    tag: [],
    q: "",
    include_ignored: false,
    include_locked: true,
    split_by_owners: true,
  };
}

export function initialChecklistFilters(refs) {
  return {
    bank_account: refs.accounts.map((item) => item.id),
    category: [UNASSIGNED, ...refs.categories.map((item) => item.id)],
    direction: ["income", "expense"],
    subcategory: [UNASSIGNED, ...refs.subcategories.map((item) => item.id)],
    tag: [],
    want_need_investment: [...wniOptions.map(([value]) => value), UNASSIGNED],
  };
}

const REFERENCE_CHECKLISTS = [
  ["bank_account", "accounts"],
  ["category", "categories"],
  ["subcategory", "subcategories"],
  ["tag", "tags"],
];

export function syncChecklistFilters(filters, previousRefs, nextRefs) {
  let changed = false;
  const next = { ...filters };
  REFERENCE_CHECKLISTS.forEach(([filterKey, refKey]) => {
    const previousIds = new Set(previousRefs[refKey].map((item) => item.id));
    const nextIds = nextRefs[refKey].map((item) => item.id);
    const nextIdSet = new Set(nextIds);
    const selection = filters[filterKey] || [];
    const kept = selection.filter((value) => value === UNASSIGNED || value === ANY_TAG || nextIdSet.has(value));
    const added = OPTIONAL_CHECKLIST_FILTER_KEYS.includes(filterKey)
      ? []
      : nextIds.filter((id) => !previousIds.has(id));
    if (kept.length !== selection.length || added.length) {
      next[filterKey] = [...kept, ...added];
      changed = true;
    }
  });
  return changed ? next : filters;
}

export function normalizeTagSelection(selection, tags) {
  const values = selection || [];
  const coversAllTags = values.includes(ANY_TAG) || tags.every((tag) => values.includes(tag.id));
  return values.includes(UNASSIGNED) && coversAllTags ? [] : values;
}

// A lazily loaded page whose code can't be fetched (the backend isn't answering) fails
// with one of these messages: Chrome and Electron, Firefox, Safari.
export function isChunkLoadError(error) {
  return /dynamically imported module|Importing a module script failed/i.test(String(error?.message || ""));
}

// How long a toast stays: 2.6 s for a short note, longer for longer messages (errors
// usually are), at most 12 s.
export function toastDuration(message) {
  const length = String(message || "").length;
  return Math.min(12000, Math.max(2600, 1200 + length * 60));
}

// The subcategories the filter offers: selecting categories narrows them.
export function offeredSubcategories(selectedCategories, subcategories) {
  const selected = selectedCategories || [];
  if (!selected.length) {
    return { unassigned: true, items: subcategories };
  }
  const categoryIds = new Set(selected.filter((item) => item !== UNASSIGNED));
  return {
    unassigned: selected.includes(UNASSIGNED),
    items: subcategories.filter((item) => categoryIds.has(item.category?.id)),
  };
}

// The number of filters a saved preset applies, counted like the live filters.
export function presetFilterCount(filters, refs, dateDefaults) {
  return countActiveFilters(filters || {}, refs, dateDefaults);
}

export function cloneFilters(filters) {
  return {
    ...emptyFilters(),
    ...filters,
    bank_account: [...(filters.bank_account || [])],
    category: [...(filters.category || [])],
    direction: [...(filters.direction || [])],
    subcategory: [...(filters.subcategory || [])],
    tag: [...(filters.tag || [])],
    want_need_investment: [...(filters.want_need_investment || [])],
  };
}

// How many filters narrow the transactions. A checklist counts once when it leaves out
// something it offers; the tag filter and search when set; the date range when it
// differs from the default range (oldest transaction to today); the ignored and locked
// switches when not at their defaults. "Divide by owners" changes amounts, not rows.
export function countActiveFilters(filters, refs, dateDefaults) {
  const offeredValues = initialChecklistFilters(refs);
  const subcategories = offeredSubcategories(filters.category, refs.subcategories);
  offeredValues.subcategory = [
    ...(subcategories.unassigned ? [UNASSIGNED] : []),
    ...subcategories.items.map((item) => item.id),
  ];
  let count = ["bank_account", "category", "direction", "subcategory", "want_need_investment"]
    .filter((key) => {
      const selected = new Set(filters[key] || []);
      return offeredValues[key].some((value) => !selected.has(value));
    })
    .length;
  if (normalizeTagSelection(filters.tag, refs.tags).length) {
    count += 1;
  }
  if (String(filters.q || "").trim()) {
    count += 1;
  }
  const dateFrom = filters.date_from || "";
  const dateTo = filters.date_to || "";
  if (dateDefaults ? dateFrom !== (dateDefaults.from || "") || dateTo !== (dateDefaults.to || "") : dateFrom || dateTo) {
    count += 1;
  }
  if (filters.include_ignored) {
    count += 1;
  }
  if (filters.include_locked === false) {
    count += 1;
  }
  return count;
}

// Clear filters has something to reset: a filter that narrows the rows, or the View's
// owner split turned off (it changes amounts, so it isn't counted above).
export function canClearFilters(filters, refs, dateDefaults) {
  return countActiveFilters(filters, refs, dateDefaults) > 0 || filters.split_by_owners === false;
}

export function getStoredFilterPresets() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FILTER_PRESETS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeFilterPresets(presets) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

// A remembered choice, such as the open tab. Storage can be missing or throw (a private
// window, blocked site data); then the fallback applies and nothing is remembered.
export function readStoredChoice(key, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function storeChoice(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is optional; the choice still holds while the app runs.
  }
}

// A checklist filter's state for its button: "All", "None", the one chosen item, or
// "2 of 3". The optional tag list reads "Any" when empty. Values that aren't offered
// (deleted items) don't count.
export function checklistSummary(selected, options, { optional = false } = {}) {
  const chosen = options.filter(([value]) => (selected || []).includes(value));
  if (optional) {
    if (!chosen.length) {
      return "Any";
    }
    return chosen.length === 1 ? chosen[0][1] : `${chosen.length} selected`;
  }
  if (!options.length) {
    // Nothing to choose from (no accounts yet): nothing is left out.
    return "All";
  }
  if (!chosen.length) {
    return "None";
  }
  if (chosen.length === options.length) {
    return "All";
  }
  return chosen.length === 1 ? chosen[0][1] : `${chosen.length} of ${options.length}`;
}

// Whether a checklist leaves out something it offers, as countActiveFilters counts it.
export function checklistNarrows(selected, options) {
  const chosen = new Set(selected || []);
  return options.some(([value]) => !chosen.has(value));
}

// The View button's text: how amounts are shown and which rows are included.
export function viewSummary(filters) {
  return [
    filters.split_by_owners ? "Split by owners" : "Full amounts",
    filters.include_ignored ? "+ ignored" : "",
    filters.include_locked === false ? "no locked" : "",
  ].filter(Boolean).join(", ");
}


export function buildFilterParams(filters) {
  const params = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (["include_ignored", "include_locked", "split_by_owners"].includes(key)) return;
    if (CHECKLIST_FILTER_KEYS.includes(key)) {
      if (Array.isArray(value) && value.length) {
        params[key] = value.join(",");
      } else if (!OPTIONAL_CHECKLIST_FILTER_KEYS.includes(key)) {
        params[key] = NO_SELECTION;
      }
      return;
    }
    if (Array.isArray(value) ? value.length : value) {
      params[key] = Array.isArray(value) ? value.join(",") : value;
    }
  });
  if (filters.include_ignored) {
    params.include_ignored = "true";
  }
  if (filters.include_locked) {
    params.include_locked = "true";
  }
  if (filters.split_by_owners) {
    params.split_by_owners = "true";
  }
  return params;
}

const NO_VALUE = "–";

// The dashboard's row of totals, from the summary alone (it doesn't wait for the
// transaction list). Averages divide by every month in the range, empty ones too.
export function buildTotals(summary, hideAmounts = false, currency = "") {
  if (!summary) {
    return [
      ["income", "Income"],
      ["expenses", "Expenses"],
      ["net", "Net"],
      ["transactions", "Transactions"],
      ["uncategorized", "Uncategorized"],
    ].map(([key, label]) => ({ key, label, value: NO_VALUE, tone: "", detail: "" }));
  }
  const unit = currency || summary.default_currency || "";
  const monthly = summary.monthly || [];
  const monthCount = completeMonthlyRows(monthly).length || 1;
  const income = monthly.reduce((acc, row) => acc + Number(row.income || 0), 0);
  const expense = monthly.reduce((acc, row) => acc + Number(row.expense || 0), 0);
  const net = income - expense;
  const amount = (value) => formatMoneyWithCurrency(value, unit, hideAmounts);
  const average = (value) => `avg ${amount(value / monthCount)} / month`;
  return [
    { key: "income", label: "Income", value: amount(income), tone: "positive", detail: average(income) },
    { key: "expenses", label: "Expenses", value: amount(expense), tone: "negative", detail: average(expense) },
    { key: "net", label: "Net", value: amount(net), tone: "metric-blue", detail: average(net) },
    {
      key: "transactions",
      label: "Transactions",
      value: formatCount(summary.transaction_count),
      tone: "",
      detail: `of ${formatCount(summary.total_transaction_count)} in total`,
    },
    { key: "uncategorized", label: "Uncategorized", value: formatCount(summary.uncategorized_count), tone: "", detail: "" },
  ];
}

// A side of the dashboard's category breakdown (the summary's category tree), largest
// first, with each amount's share of the side's total. Subcategories without a colour
// take their category's.
export function rankCategories(tree) {
  const categories = (tree || [])
    .map((category) => ({
      name: category.name,
      color: normalizeHexColor(category.color),
      amount: Number(category.amount || 0),
      children: (category.children || []).map((child) => ({
        name: child.name,
        color: normalizeHexColor(child.color) || normalizeHexColor(category.color),
        amount: Number(child.amount || 0),
      })),
    }))
    .filter((category) => category.amount > 0);
  const total = categories.reduce((acc, category) => acc + category.amount, 0);
  const share = (amount) => (total > 0 ? amount / total : 0);
  const byAmount = (left, right) => right.amount - left.amount;
  const rows = categories.sort(byAmount).map((category) => ({
    ...category,
    share: share(category.amount),
    children: category.children
      .filter((child) => child.amount > 0)
      .sort(byAmount)
      .map((child) => ({ ...child, share: share(child.amount) })),
  }));
  return { total, rows };
}

// Categories that start open: one that makes up more than half of its side.
export function autoOpenCategories(rows) {
  return rows.filter((row) => row.share > 0.5).map((row) => row.name);
}

// Want / Need / Investment as parts of one bar, largest first, unassigned last.
export function wniSplit(rows) {
  const parts = (rows || [])
    .map((row) => ({ name: String(row.name || "uncategorized").toLowerCase(), amount: Number(row.amount || 0) }))
    .filter((part) => part.amount > 0);
  const total = parts.reduce((acc, part) => acc + part.amount, 0);
  return parts
    .sort((left, right) => (
      Number(left.name === "uncategorized") - Number(right.name === "uncategorized") || right.amount - left.amount
    ))
    .map((part) => ({ ...part, share: total > 0 ? part.amount / total : 0 }));
}

// Months between the Monthly flow chart's labels, so long ranges stay readable.
export function monthlyTickStep(monthCount) {
  if (monthCount <= 14) {
    return "M1";
  }
  if (monthCount <= 36) {
    return "M3";
  }
  return monthCount <= 72 ? "M6" : "M12";
}

export function baseLayout(extra = {}) {
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

export function cssVar(name, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function wniColor(value) {
  const colors = {
    investment: cssVar("--wni-investment", "#d29922"),
    need: cssVar("--wni-need", "#58a6ff"),
    uncategorized: cssVar("--wni-uncategorized", "#8b949e"),
    want: cssVar("--wni-want", "#a371f7"),
  };
  return colors[String(value || "uncategorized").toLowerCase()] || colors.uncategorized;
}

export function completeMonthlyRows(rows) {
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

export function findDuplicate(items, field, value, editingId = null) {
  const normalizedValue = normalizeComparable(value);
  if (!normalizedValue) {
    return null;
  }
  return items.find((item) => item.id !== editingId && normalizeComparable(item[field]) === normalizedValue) || null;
}

export function findDuplicateSubcategory(items, categoryId, name, editingId = null) {
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

export function validateRequiredFields(form, names, notify) {
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

export function validateRequiredColumnMap(columnMap, notify) {
  const requiredFields = [
    ["transaction_date", "Transaction date"],
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

export function fieldLabel(name) {
  return String(name || "")
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase();
}

export function formObject(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (!key.startsWith("sample_")) {
      data[key] = value;
    }
  });
  return data;
}

export function guessColumnMap(headers) {
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

export function sanitizeColumnMap(columnMap) {
  const visibleKeys = new Set(mappingFields.map(([key]) => key));
  return Object.fromEntries(Object.entries(columnMap || {}).filter(([key]) => visibleKeys.has(key)));
}

export function mappedColumnOptions(headers, columnMap) {
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
  return options.sort((left, right) => left.localeCompare(right));
}

export function parsingSettingsFromMapping(mapping) {
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

export function normalizeName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function coerceArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function lines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function subLabel(item) {
  return `${item.category?.name || "No category"} / ${item.name}`;
}

export function money(value) {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

export function amountNumber(value) {
  return formatNumber(value, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

// The API sends money as decimal strings ("-12.50"), which would sort as text.
// Grid comparator: numeric order, missing values first.
export function compareAmounts(left, right) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing || rightMissing) {
    return Number(rightMissing) - Number(leftMissing);
  }
  return Number(left) - Number(right);
}

export function formatMoneyValue(value, hideAmounts = false) {
  return hideAmounts ? HIDDEN_AMOUNT : money(value);
}

export function formatAmountValue(value, hideAmounts = false) {
  return hideAmounts ? HIDDEN_AMOUNT : amountNumber(value);
}

export function formatMoneyWithCurrency(value, currency, hideAmounts = false) {
  const formatted = formatMoneyValue(value, hideAmounts);
  return hideAmounts || !currency ? formatted : `${formatted} ${currency}`;
}

export function formatAmountWithCurrency(value, currency, hideAmounts = false) {
  const formatted = formatAmountValue(value, hideAmounts);
  return hideAmounts || !currency ? formatted : `${formatted} ${currency}`;
}

export function formatBytes(value, fallback = "") {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) {
    return fallback;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The backend refuses larger uploads (MAX_IMPORT_FILE_BYTES and MAX_BACKUP_FILE_BYTES in views.py).
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_FILE_BYTES = 1024 * 1024 * 1024;

export function fileTooLargeMessage(file, maxBytes) {
  if (!file || file.size <= maxBytes) {
    return "";
  }
  return `The file is too large (${formatBytes(file.size)}). The limit is ${Math.round(maxBytes / (1024 * 1024))} MB.`;
}

// Local time as YYYY-MM-DD HH:MM, like the dates elsewhere in the app.
export function formatDateTime(value, fallback = "") {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const time = [date.getHours(), date.getMinutes()].map((part) => String(part).padStart(2, "0")).join(":");
  return `${formatDateInput(date)} ${time}`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatCount(count)} ${Number(count) === 1 ? singular : plural}`;
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("en-US", options).format(Number(value || 0)).replace(/,/g, " ");
}

export function formatCount(value) {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

export function colorPillStyle(color) {
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

// A tag's colour for a TagToggleList pill, as CSS variables: filled when on, its outline
// when off. None for a tag without a valid colour (the pill stays grey).
export function tagToggleStyle(color) {
  const background = normalizeHexColor(color);
  return background ? { "--tag-color": background, "--tag-text": readableTextColor(background) } : undefined;
}

export function tagTitle(tags) {
  return tags.length ? tags.map((tag) => tag.name).join(", ") : "Untagged";
}

export function estimateVisibleTagCount(tags, width) {
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

export function estimateTagPillWidth(label) {
  return Math.min(150, Math.max(42, String(label || "").length * 7 + 24));
}

export function normalizeHexColor(color) {
  const value = String(color || "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "";
}

export function readableTextColor(hex) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#08111d" : "#ffffff";
}

export function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function todayInputValue() {
  return formatDateInput(new Date());
}

export function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// A date typed as YYYY-MM-DD, or null when it isn't one: incomplete, or not on the
// calendar ("2026-02-30").
export function parseDateInput(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  const isSameDay = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return isSameDay ? date : null;
}

export function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function addMonths(date, amount) {
  // Clamp to the target month's last day; setMonth would roll Mar 31 - 1 month into Mar 3.
  const targetMonth = date.getMonth() + amount;
  const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDay));
}

// A month as the date picker shows it: 6 weeks of 7 days, Monday first, starting on or
// before the 1st. Always 6 rows, so the calendar keeps its height between months.
export function calendarWeeks(year, month) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, week) => (
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day))
  ));
}

export const QUICK_RANGES = [
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["3-months", "3 months"],
  ["12-months", "12 months"],
  ["this-year", "This year"],
  ["all", "All"],
];

// The dates a quick pick sets. Month ranges are whole calendar months up to today
// ("12 months" is this month and the 11 before it), so the monthly chart shows whole
// months. "All" starts at the oldest transaction.
export function quickDateRange(id, today, oldest) {
  const end = parseDateInput(today) || new Date();
  const to = formatDateInput(end);
  const monthStart = (monthsBack) => formatDateInput(new Date(end.getFullYear(), end.getMonth() - monthsBack, 1));
  switch (id) {
    case "this-month":
      return { from: monthStart(0), to };
    case "last-month":
      return { from: monthStart(1), to: formatDateInput(new Date(end.getFullYear(), end.getMonth(), 0)) };
    case "3-months":
      return { from: monthStart(2), to };
    case "12-months":
      return { from: monthStart(11), to };
    case "this-year":
      return { from: formatDateInput(new Date(end.getFullYear(), 0, 1)), to };
    default:
      return { from: oldest || "", to };
  }
}

// Every pick whose range equals the dates: in January, This month and This year are the same.
export function activeQuickRanges(dateFrom, dateTo, today, oldest) {
  return QUICK_RANGES.map(([id]) => id).filter((id) => {
    const range = quickDateRange(id, today, oldest);
    return range.from === dateFrom && range.to === dateTo;
  });
}
