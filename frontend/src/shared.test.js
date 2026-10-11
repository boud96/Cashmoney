import { describe, expect, it } from "vitest";

import {
  ANY_TAG,
  NO_SELECTION,
  UNASSIGNED,
  buildFilterParams,
  compareAmounts,
  completeMonthlyRows,
  countActiveFilters,
  emptyFilters,
  fileTooLargeMessage,
  formatAmountWithCurrency,
  formatDateInput,
  formatMoneyWithCurrency,
  initialChecklistFilters,
  normalizeName,
  normalizeTagSelection,
  presetFilterCount,
  subtractRelativeDate,
  sunburstData,
  syncChecklistFilters,
  tagTitle,
  toastDuration,
  topExpenseSubcategories,
} from "./shared.js";

describe("money from the API (decimal strings)", () => {
  it("formats decimal strings", () => {
    expect(formatAmountWithCurrency("-1234.50", "CZK")).toBe("-1 234.5 CZK");
    expect(formatMoneyWithCurrency("1234.56", "CZK")).toBe("1 235 CZK");
  });

  it("sorts amounts as numbers, missing values first", () => {
    const amounts = ["10.00", "9.00", null, "-100.00", "-20.00"];
    expect([...amounts].sort(compareAmounts)).toEqual([null, "-100.00", "-20.00", "9.00", "10.00"]);
  });

  it("gives charts numbers, with a category covering its children", () => {
    const { values } = sunburstData([
      { name: "Food", amount: "6.66", color: "", children: [
        { name: "Coffee", amount: "3.33", color: "" },
        { name: "Groceries", amount: "3.33", color: "" },
      ] },
    ]);
    expect(values).toEqual([6.66, 3.33, 3.33]);
    // Plotly's branchvalues "total" drops a parent below the sum of its children.
    expect(values[0]).toBeGreaterThanOrEqual((values[1] + values[2]) * (1 - 1e-9));
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

  it("orders the top expenses by amount, not as text", () => {
    const rows = topExpenseSubcategories([
      { name: "A", children: [{ name: "x", amount: "9.00" }, { name: "y", amount: "10.00" }] },
    ]);
    expect(rows.map((row) => row.amount)).toEqual([9, 10]);
  });
});

describe("relative date ranges", () => {
  const monthsBack = (date, amount) => formatDateInput(subtractRelativeDate(date, amount, "months"));

  it("clamps to the end of a shorter month", () => {
    expect(monthsBack(new Date(2026, 2, 31), 1)).toBe("2026-02-28");
    expect(monthsBack(new Date(2024, 2, 31), 1)).toBe("2024-02-29");
    expect(monthsBack(new Date(2026, 4, 31), 1)).toBe("2026-04-30");
  });

  it("crosses year boundaries", () => {
    expect(monthsBack(new Date(2026, 0, 15), 2)).toBe("2025-11-15");
    expect(formatDateInput(subtractRelativeDate(new Date(2026, 0, 3), 1, "weeks"))).toBe("2025-12-27");
    expect(formatDateInput(subtractRelativeDate(new Date(2026, 2, 1), 1, "days"))).toBe("2026-02-28");
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

  it("keeps longer toasts up longer, within limits", () => {
    expect(toastDuration("Saved")).toBe(2600);
    expect(toastDuration("x".repeat(100))).toBe(7200);
    expect(toastDuration("x".repeat(1000))).toBe(12000);
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
