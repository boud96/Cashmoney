export const UNASSIGNED = "__unassigned__";
export const NO_SELECTION = "__none__";
export const CHECKLIST_FILTER_KEYS = [
  "bank_account",
  "category",
  "direction",
  "subcategory",
  "want_need_investment",
  "tag",
];
export const pages = {
  dashboard: ["Dashboard", "Monthly flow, category mix, and transaction review."],
  import: ["Import", "Load bank statement CSV files into the local transaction database."],
  settings: ["Definitions", "Manage accounts, mappings, categories, tags, and keyword rules."],
  maintenance: ["Maintenance", "Database snapshot and destructive cleanup tools."],
  help: ["Help", "Usage guide for importing, categorizing, reviewing, and maintaining your finance data."],
};
export const THEME_STORAGE_KEY = "cashmoney-theme";
export const ACCENT_STORAGE_KEY = "cashmoney-accent";
export const HIDE_AMOUNTS_STORAGE_KEY = "cashmoney-hide-amounts";
export const FILTER_PRESETS_STORAGE_KEY = "cashmoney-filter-presets";
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
  "Bank Accounts": "Bank accounts group imported transactions by account, bank, currency, owner count, and optional default CSV mapping.",
  "CSV Mappings": "CSV mappings describe how a bank statement file should be parsed, including separators, date formats, columns, and categorization text fields.",
  Categories: "Categories are the top-level buckets used for dashboard breakdowns and reporting.",
  Subcategories: "Subcategories sit under categories and are the actual category-like value assigned to transactions.",
  Tags: "Tags are optional labels that can be attached to multiple transactions for flexible filtering.",
  Keywords: "Keywords automatically categorize transactions by matching text and assigning subcategory, WNI, tags, or ignored status.",
};
export const mappingFields = [
  ["original_id", "Original ID"],
  ["transaction_date", "Transaction Date"],
  ["posted_date", "Posted Date"],
  ["description", "Description"],
  ["amount", "Amount"],
  ["currency", "Currency"],
  ["counterparty_name", "Counterparty Name"],
  ["counterparty_account_number", "Counterparty Account"],
  ["transaction_type", "Transaction Type"],
  ["variable_symbol", "Variable Symbol"],
  ["specific_symbol", "Specific Symbol"],
  ["constant_symbol", "Constant Symbol"],
  ["counterparty_note", "Counterparty Note"],
  ["my_note", "My Note"],
  ["other_note", "Other Note"],
];
export const categorizationFieldOptions = mappingFields.filter(
  ([key]) => !["original_id", "transaction_date", "posted_date", "amount", "currency"].includes(key),
);
export const defaultCategorizationFields = categorizationFieldOptions.map(([key]) => key);
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
    tag: [UNASSIGNED, ...refs.tags.map((item) => item.id)],
    want_need_investment: [...wniOptions.map(([value]) => value), UNASSIGNED],
  };
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

export function countActiveFilters(filters) {
  return Object.entries(filters).reduce((count, [key, value]) => {
    if (Array.isArray(value)) {
      return count + value.length;
    }
    if (typeof value === "boolean") {
      return count + (value ? 1 : 0);
    }
    return count + (value ? 1 : 0);
  }, 0);
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


export function buildFilterParams(filters) {
  const params = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (["include_ignored", "include_locked", "split_by_owners"].includes(key)) return;
    if (CHECKLIST_FILTER_KEYS.includes(key)) {
      params[key] = Array.isArray(value) && value.length ? value.join(",") : NO_SELECTION;
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

export function buildMetrics(summary, transactionPage, hideAmounts = false, defaultCurrency = "") {
  const monthly = summary?.monthly || [];
  const currency = defaultCurrency || summary?.default_currency || "";
  const monthCount = monthly.length || 1;
  const income = monthly.reduce((acc, row) => acc + Number(row.income || 0), 0);
  const expense = monthly.reduce((acc, row) => acc + Number(row.expense || 0), 0);
  const net = income - expense;
  const uncategorized = (transactionPage.results || []).filter((row) => !row.category && !row.is_ignored).length;
  return [
    ["Incomes", formatMoneyWithCurrency(income, currency, hideAmounts), "positive", { value: formatMoneyWithCurrency(income / monthCount, currency, hideAmounts), tone: "positive" }],
    ["Expenses", formatMoneyWithCurrency(expense, currency, hideAmounts), "negative", { value: formatMoneyWithCurrency(expense / monthCount, currency, hideAmounts), tone: "negative" }],
    ["Net", formatMoneyWithCurrency(net, currency, hideAmounts), "metric-blue", { value: formatMoneyWithCurrency(net / monthCount, currency, hideAmounts), tone: "metric-blue" }],
    ["Transactions", `${transactionPage.count.toLocaleString()} / ${(transactionPage.total_count ?? transactionPage.count).toLocaleString()}`, ""],
    ["Uncategorized", uncategorized.toLocaleString(), ""],
  ];
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

export function sunburstData(rows) {
  const colors = [];
  const ids = [];
  const labels = [];
  const parents = [];
  const values = [];
  rows.forEach((category) => {
    const categoryId = `category:${category.name}`;
    ids.push(categoryId);
    labels.push(category.name);
    parents.push("");
    values.push(category.amount);
    colors.push(normalizeHexColor(category.color) || cssVar("--muted", "#667481"));
    (category.children || []).forEach((child) => {
      ids.push(`${categoryId}:${child.name}`);
      labels.push(child.name);
      parents.push(categoryId);
      values.push(child.amount);
      colors.push(normalizeHexColor(child.color) || normalizeHexColor(category.color) || cssVar("--surface-2", "#eef3f6"));
    });
  });
  return { colors, ids, labels, parents, values };
}

export function topExpenseSubcategories(rows) {
  return rows
    .flatMap((category) => (category.children || []).map((child) => ({
      amount: Number(child.amount || 0),
      label: `${category.name} / ${child.name}`,
    })))
    .filter((row) => row.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 8)
    .reverse();
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

export function buildSidebarAsciiFrame(frame, size) {
  const width = size.columns;
  const height = size.rows;
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  const background = "   .   +   _   ";
  const ribbon = "CA$HMONEY";

  function write(row, col, text) {
    if (row < 0 || row >= height) {
      return;
    }
    String(text).split("").forEach((char, index) => {
      const x = col + index;
      if (x >= 0 && x < width) {
        rows[row][x] = char;
      }
    });
  }

  const time = frame * 0.12;
  for (let y = 0; y < height; y += 1) {
    const rowDrift = Math.sin(y * 0.18 + time * 0.9) * 4 + Math.sin(y * 0.07 - time * 0.55) * 7;
    for (let x = 0; x < width; x += 1) {
      const primaryCenter =
        width / 2 +
        Math.sin(y * 0.21 + time) * width * 0.22 +
        Math.sin(y * 0.055 - time * 0.7) * width * 0.08;
      const secondaryCenter =
        width / 2 +
        Math.sin(y * 0.17 - time * 0.85 + Math.PI) * width * 0.2 +
        Math.sin(y * 0.075 + time * 0.5) * width * 0.07;
      const tertiaryCenter =
        width / 2 +
        Math.sin(y * 0.13 + time * 0.7 + Math.PI / 2) * width * 0.15;
      const distance = Math.min(
        Math.abs(x - primaryCenter),
        Math.abs(x - secondaryCenter),
        Math.abs(x - tertiaryCenter),
      );

      if (distance < 0.9) {
        rows[y][x] = ribbon[Math.abs(Math.floor(x + y + time * 3)) % ribbon.length];
      } else if (distance < 2.5) {
        rows[y][x] = "+";
      } else if (distance < 4.5) {
        rows[y][x] = ".";
      } else {
        const charIndex = Math.abs(Math.floor(x + y * 0.7 + rowDrift + time * 2)) % background.length;
        rows[y][x] = background[charIndex];
      }
    }
  }

  const label = "Cashmoney";
  const labelRow = 7;
  const labelCol = Math.max(0, Math.floor((width - label.length) / 2));
  write(labelRow, labelCol, label);

  return rows.map((row) => row.join("")).join("\n");
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
    ["transaction_date", "Transaction Date"],
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
  return formatNumber(value, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
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

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("en-US", options).format(Number(value || 0)).replace(/,/g, " ");
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString();
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

export function tagTitle(tags) {
  return tags.length ? tags.map((tag) => tag.name).join(", ") : "No tags";
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

export function subtractRelativeDate(date, amount, unit) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === "weeks") {
    next.setDate(next.getDate() - amount * 7);
  } else if (unit === "months") {
    next.setMonth(next.getMonth() - amount);
  } else {
    next.setDate(next.getDate() - amount);
  }
  return next;
}
