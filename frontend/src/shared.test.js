import { describe, expect, it } from "vitest";

import {
  ANY_TAG,
  NO_SELECTION,
  UNASSIGNED,
  activeQuickRanges,
  addDays,
  addMonths,
  autoOpenCategories,
  buildFilterParams,
  buildTotals,
  calendarWeeks,
  checklistNarrows,
  checklistSummary,
  compareAmounts,
  completeMonthlyRows,
  canClearFilters,
  countActiveFilters,
  emptyFilters,
  fileTooLargeMessage,
  formatAmountValue,
  formatAmountWithCurrency,
  formatDateInput,
  formatDateTime,
  formatMoneyWithCurrency,
  initialChecklistFilters,
  isChunkLoadError,
  monthlyTickStep,
  normalizeName,
  normalizeTagSelection,
  parseDateInput,
  pluralize,
  presetFilterCount,
  quickDateRange,
  rankCategories,
  tagToggleStyle,
  syncChecklistFilters,
  tagTitle,
  toastDuration,
  viewSummary,
  wniSplit,
} from "./shared.js";

describe("money from the API (decimal strings)", () => {
  it("formats decimal strings", () => {
    expect(formatAmountWithCurrency("-1234.50", "CZK")).toBe("-1 234.50 CZK");
    expect(formatMoneyWithCurrency("1234.56", "CZK")).toBe("1 235 CZK");
  });

  it("sorts amounts as numbers, missing values first", () => {
    const amounts = ["10.00", "9.00", null, "-100.00", "-20.00"];
    expect([...amounts].sort(compareAmounts)).toEqual([null, "-100.00", "-20.00", "9.00", "10.00"]);
  });

  it("adds monthly rows as numbers and fills in missing months", () => {
    const rows = completeMonthlyRows([
      { month: "2026-01", income: "100.10", expense: "0.20" },
      { month: "2026-03", income: "0.00", expense: "50.00" },
    ]);
    expect(rows.map((row) => row.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(rows[1]).toMatchObject({ income: 0, expense: 0, net: 0 });
    expect(rows[2]).toMatchObject({ income: 0, expense: 50, net: -50 });
  });

});

describe("tag pills", () => {
  it("colours a pill from the tag's colour, with readable text", () => {
    expect(tagToggleStyle("#1C7ED6")).toEqual({ "--tag-color": "#1C7ED6", "--tag-text": "#ffffff" });
    expect(tagToggleStyle("#99E7E2")).toEqual({ "--tag-color": "#99E7E2", "--tag-text": "#08111d" });
  });

  it("leaves a tag without a valid colour grey", () => {
    for (const color of ["", null, undefined, "red", "#12345", "#1234567"]) {
      expect(tagToggleStyle(color)).toBeUndefined();
    }
  });
});

describe("date picker", () => {
  it("accepts only complete, real YYYY-MM-DD dates", () => {
    expect(formatDateInput(parseDateInput("2026-10-11"))).toBe("2026-10-11");
    expect(formatDateInput(parseDateInput("2024-02-29"))).toBe("2024-02-29");
    for (const text of ["", "2026-1", "2026-01-0", "2026-1-01", "20260101", "2026-02-29", "2026-13-01", "2026-10-11 "]) {
      expect(parseDateInput(text)).toBeNull();
    }
  });

  it("lays a month out in 6 weeks, Monday first", () => {
    const weeks = calendarWeeks(2026, 1); // February 2026 starts on a Sunday
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(formatDateInput(weeks[0][0])).toBe("2026-01-26");
    expect(formatDateInput(weeks[0][6])).toBe("2026-02-01");
    expect(formatDateInput(weeks[5][6])).toBe("2026-03-08");
    expect(formatDateInput(calendarWeeks(2026, 5)[0][0])).toBe("2026-06-01"); // June 1st is a Monday
  });

  it("moves by days and months, clamping to shorter months", () => {
    expect(formatDateInput(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
    expect(formatDateInput(addDays(new Date(2026, 2, 1), -1))).toBe("2026-02-28");
    expect(formatDateInput(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(formatDateInput(addMonths(new Date(2026, 0, 15), -1))).toBe("2025-12-15");
    expect(formatDateInput(addMonths(new Date(2026, 10, 30), 12))).toBe("2027-11-30");
  });
});

describe("filters", () => {
  it("builds query params", () => {
    expect(buildFilterParams({
      bank_account: ["a", "b"],
      category: [],
      tag: [],
      search: "kava",
      date_from: "2026-01-01",
      include_ignored: true,
      split_by_owners: false,
    })).toEqual({
      bank_account: "a,b",
      category: NO_SELECTION,
      search: "kava",
      date_from: "2026-01-01",
      include_ignored: "true",
    });
  });

  it("treats Untagged plus every tag as no tag filter", () => {
    const tags = [{ id: "t1" }, { id: "t2" }];
    expect(normalizeTagSelection([UNASSIGNED, "t1", "t2"], tags)).toEqual([]);
    expect(normalizeTagSelection([UNASSIGNED, "t1"], tags)).toEqual([UNASSIGNED, "t1"]);
  });

  it("treats Untagged plus Tagged as no tag filter, and Tagged alone as a filter", () => {
    const tags = [{ id: "t1" }, { id: "t2" }];
    expect(normalizeTagSelection([UNASSIGNED, ANY_TAG], tags)).toEqual([]);
    expect(normalizeTagSelection([ANY_TAG], tags)).toEqual([ANY_TAG]);
    expect(buildFilterParams({ tag: [ANY_TAG] })).toEqual({ tag: ANY_TAG });
  });

  it("keeps Tagged when the tag list changes", () => {
    const before = { accounts: [], categories: [], subcategories: [], tags: [{ id: "t1" }] };
    const after = { ...before, tags: [{ id: "t2" }] };
    const synced = syncChecklistFilters({ bank_account: [], category: [], subcategory: [], tag: [ANY_TAG, "t1"] }, before, after);
    expect(synced.tag).toEqual([ANY_TAG]);
  });

  it("recognizes a page whose code couldn't be loaded", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:8765/static/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: http://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("keeps longer toasts up longer, within limits", () => {
    expect(toastDuration("Saved")).toBe(2600);
    expect(toastDuration("x".repeat(100))).toBe(7200);
    expect(toastDuration("x".repeat(1000))).toBe(12000);
  });

  it("keeps a toast with a button (Undo) up long enough to use it", () => {
    expect(toastDuration('Deleted "Cash"', { withAction: true })).toBe(8000);
    expect(toastDuration("x".repeat(1000), { withAction: true })).toBe(12000);
  });

  describe("active filter count", () => {
    const refs = {
      accounts: [{ id: "a" }, { id: "b" }],
      categories: [{ id: "c1" }, { id: "c2" }],
      subcategories: [{ id: "s1", category: { id: "c1" } }, { id: "s2", category: { id: "c2" } }],
      tags: [{ id: "t1" }, { id: "t2" }],
    };
    const dates = { from: "2024-01-01", to: "2026-10-11" };
    const startup = () => ({
      ...emptyFilters(),
      ...initialChecklistFilters(refs),
      date_from: dates.from,
      date_to: dates.to,
    });

    it("is zero at startup, although every checklist option is checked", () => {
      expect(countActiveFilters(startup(), refs, dates)).toBe(0);
    });

    it("counts each filter that narrows the rows once", () => {
      const filters = {
        ...startup(),
        bank_account: ["a"],
        direction: ["expense"],
        q: " kava ",
        date_from: "2026-01-01",
        include_ignored: true,
      };
      expect(countActiveFilters(filters, refs, dates)).toBe(5);
    });

    it("can clear the filters when only the owner split is off", () => {
      expect(canClearFilters(startup(), refs, dates)).toBe(false);
      expect(canClearFilters({ ...startup(), split_by_owners: false }, refs, dates)).toBe(true);
      expect(canClearFilters({ ...startup(), q: "kava" }, refs, dates)).toBe(true);
    });

    it("doesn't count the subcategories a category choice hides", () => {
      expect(countActiveFilters({ ...startup(), category: ["c1"], subcategory: ["s1"] }, refs, dates)).toBe(1);
    });

    it("counts a saved preset as it applies", () => {
      expect(presetFilterCount({ ...startup(), tag: [UNASSIGNED, "t1", "t2"] }, refs, dates)).toBe(0);
      expect(presetFilterCount({ ...startup(), tag: ["t1"] }, refs, dates)).toBe(1);
      expect(presetFilterCount({ ...startup(), include_locked: false, split_by_owners: false }, refs, dates)).toBe(1);
    });
  });

  it("keeps the same filters object when the references didn't change", () => {
    const refs = { accounts: [{ id: "a" }], categories: [], subcategories: [], tags: [] };
    const filters = { bank_account: ["a"], category: [], subcategory: [], tag: [] };
    expect(syncChecklistFilters(filters, refs, refs)).toBe(filters);
  });

  it("adds new accounts to the selection but not new tags", () => {
    const before = { accounts: [{ id: "a" }], categories: [], subcategories: [], tags: [] };
    const after = { ...before, accounts: [{ id: "a" }, { id: "b" }], tags: [{ id: "t1" }] };
    const synced = syncChecklistFilters({ bank_account: ["a"], category: [], subcategory: [], tag: [] }, before, after);
    expect(synced.bank_account).toEqual(["a", "b"]);
    expect(synced.tag).toEqual([]);
  });
});

describe("small helpers", () => {
  it("folds case and accents like the backend search", () => {
    expect(normalizeName("Kavárna ČSOB")).toBe("kavarnacsob");
  });

  it("says Untagged for a row without tags", () => {
    expect(tagTitle([])).toBe("Untagged");
    expect(tagTitle([{ name: "Trip" }, { name: "Work" }])).toBe("Trip, Work");
  });

  it("explains a file over the upload limit", () => {
    expect(fileTooLargeMessage({ size: 10 }, 20)).toBe("");
    expect(fileTooLargeMessage({ size: 3 * 1024 * 1024 }, 2 * 1024 * 1024)).toBe(
      "The file is too large (3.0 MB). The limit is 2 MB.",
    );
  });
});

describe("quick date ranges", () => {
  const today = "2026-10-27";
  const oldest = "2021-06-11";

  it("computes each pick from today", () => {
    expect(quickDateRange("this-month", today, oldest)).toEqual({ from: "2026-10-01", to: "2026-10-27" });
    expect(quickDateRange("last-month", today, oldest)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(quickDateRange("3-months", today, oldest)).toEqual({ from: "2026-08-01", to: "2026-10-27" });
    expect(quickDateRange("12-months", today, oldest)).toEqual({ from: "2025-11-01", to: "2026-10-27" });
    expect(quickDateRange("this-year", today, oldest)).toEqual({ from: "2026-01-01", to: "2026-10-27" });
    expect(quickDateRange("all", today, oldest)).toEqual({ from: "2021-06-11", to: "2026-10-27" });
  });

  it("crosses the year boundary", () => {
    expect(quickDateRange("last-month", "2026-01-15", oldest)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(quickDateRange("3-months", "2026-02-10", oldest)).toEqual({ from: "2025-12-01", to: "2026-02-10" });
  });

  it("marks every pick whose range equals the dates", () => {
    expect(activeQuickRanges("2025-11-01", "2026-10-27", today, oldest)).toEqual(["12-months"]);
    expect(activeQuickRanges("2025-11-02", "2026-10-27", today, oldest)).toEqual([]);
    // In January, This month and This year are the same range: both are pressed.
    expect(activeQuickRanges("2026-01-01", "2026-01-20", "2026-01-20", oldest)).toEqual(["this-month", "this-year"]);
  });
});

describe("wording", () => {
  it("pluralizes counts", () => {
    expect(pluralize(1, "error")).toBe("1 error");
    expect(pluralize(2, "error")).toBe("2 errors");
    expect(pluralize(0, "candidate")).toBe("0 candidates");
    expect(pluralize(1234, "transaction")).toBe("1 234 transactions");
    expect(pluralize(2, "match", "matches")).toBe("2 matches");
  });

  it("shows dates and times as YYYY-MM-DD HH:MM", () => {
    expect(formatDateTime(new Date(2026, 9, 11, 18, 36, 34).toISOString())).toBe("2026-10-11 18:36");
    expect(formatDateTime("", "Unknown date")).toBe("Unknown date");
    expect(formatDateTime("not a date")).toBe("not a date");
  });

  it("shows table amounts with two decimals", () => {
    expect(formatAmountValue("-1234.5")).toBe("-1 234.50");
    expect(formatAmountValue("18500")).toBe("18 500.00");
    expect(formatAmountWithCurrency("-1234.50", "CZK")).toBe("-1 234.50 CZK");
    expect(formatAmountValue("-1234.5", true)).toBe("----");
  });
});

describe("filter chips", () => {
  const accounts = [["a", "Airbank"], ["b", "Cash"], ["c", "KB"]];
  const tags = [[UNASSIGNED, "Untagged"], [ANY_TAG, "Tagged"], ["t1", "Trip"], ["t2", "Gift"]];

  it("summarizes a checklist", () => {
    expect(checklistSummary(["a", "b", "c"], accounts)).toBe("All");
    expect(checklistSummary([], accounts)).toBe("None");
    // Nothing to choose from (no accounts yet) narrows nothing.
    expect(checklistSummary([], [])).toBe("All");
    expect(checklistSummary(["b"], accounts)).toBe("Cash");
    expect(checklistSummary(["a", "c"], accounts)).toBe("2 of 3");
    expect(checklistSummary(["a", "gone"], accounts)).toBe("Airbank");
  });

  it("summarizes the optional tag list", () => {
    expect(checklistSummary([], tags, { optional: true })).toBe("Any");
    expect(checklistSummary([UNASSIGNED], tags, { optional: true })).toBe("Untagged");
    expect(checklistSummary(["t1", "t2"], tags, { optional: true })).toBe("2 selected");
  });

  it("knows when a checklist narrows the rows", () => {
    expect(checklistNarrows(["a", "b", "c"], accounts)).toBe(false);
    expect(checklistNarrows(["a"], accounts)).toBe(true);
  });

  it("summarizes the view options", () => {
    expect(viewSummary(emptyFilters())).toBe("Split by owners");
    expect(viewSummary({ ...emptyFilters(), split_by_owners: false })).toBe("Full amounts");
    expect(viewSummary({ ...emptyFilters(), include_ignored: true, include_locked: false }))
      .toBe("Split by owners, + ignored, no locked");
  });
});

describe("totals and charts", () => {
  const summary = {
    default_currency: "CZK",
    monthly: [
      { month: "2026-01", income: "1000.00", expense: "400.00" },
      { month: "2026-03", income: "500.00", expense: "100.00" },
    ],
    transaction_count: 842,
    total_transaction_count: 3987,
    uncategorized_count: 37,
  };

  it("builds the totals row from the summary alone", () => {
    const totals = Object.fromEntries(buildTotals(summary, false, "CZK").map((item) => [item.key, item]));
    expect(totals.income).toMatchObject({ label: "Income", value: "1 500 CZK", detail: "avg 500 CZK / month" });
    expect(totals.expenses).toMatchObject({ value: "500 CZK", detail: "avg 167 CZK / month" });
    expect(totals.net).toMatchObject({ value: "1 000 CZK", detail: "avg 333 CZK / month" });
    expect(totals.transactions).toMatchObject({ value: "842", detail: "of 3 987 in total" });
    expect(totals.uncategorized.value).toBe("37");
  });

  it("hides money in the totals, keeps counts", () => {
    const totals = Object.fromEntries(buildTotals(summary, true, "CZK").map((item) => [item.key, item]));
    expect(totals.income.value).toBe("----");
    expect(totals.income.detail).toBe("avg ---- / month");
    expect(totals.transactions.value).toBe("842");
  });

  it("shows dashes before the summary arrives", () => {
    expect(buildTotals(null).map((item) => item.value)).toEqual(["–", "–", "–", "–", "–"]);
  });

  it("ranks categories and their subcategories by amount", () => {
    const tree = [
      { name: "Food", color: "#16A34A", amount: "300.00", children: [
        { name: "Restaurants", color: "", amount: "100.00" },
        { name: "Groceries", color: "#22C55E", amount: "200.00" },
      ] },
      { name: "Rent", color: "#9333EA", amount: "700.00", children: [{ name: "Rent", color: "", amount: "700.00" }] },
      { name: "Empty", color: "", amount: "0.00", children: [] },
    ];
    const ranked = rankCategories(tree);
    expect(ranked.total).toBe(1000);
    expect(ranked.rows.map((row) => [row.name, row.amount, row.share])).toEqual([["Rent", 700, 0.7], ["Food", 300, 0.3]]);
    expect(ranked.rows[1].children.map((child) => [child.name, child.share])).toEqual([["Groceries", 0.2], ["Restaurants", 0.1]]);
    expect(ranked.rows[1].children[1].color).toBe("#16A34A");
    expect(autoOpenCategories(ranked.rows)).toEqual(["Rent"]);
    expect(rankCategories([])).toEqual({ total: 0, rows: [] });
  });

  it("splits want, need and investment, unassigned last", () => {
    const split = wniSplit([
      { name: "uncategorized", amount: "80" },
      { name: "want", amount: "210" },
      { name: "need", amount: "580" },
      { name: "investment", amount: "130" },
    ]);
    expect(split.map((part) => [part.name, part.share])).toEqual([
      ["need", 0.58], ["want", 0.21], ["investment", 0.13], ["uncategorized", 0.08],
    ]);
  });

  it("spaces month labels by range length", () => {
    expect([12, 14, 15, 36, 37, 72, 73].map(monthlyTickStep)).toEqual(["M1", "M1", "M3", "M3", "M6", "M6", "M12"]);
  });
});
