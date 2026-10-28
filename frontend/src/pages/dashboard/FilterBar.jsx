// The dashboard's filter bar: dates with quick picks, search and saved filters on the
// first line; a button per checklist and the View options on the second.
import { useMemo, useRef, useState } from "react";

import { DateField, HelpTooltip, PopoverButton, TagToggleList } from "../../components.jsx";
import { ChevronIcon, CloseIcon } from "../../icons.jsx";
import {
  ANY_TAG,
  QUICK_RANGES,
  UNASSIGNED,
  activeQuickRanges,
  canClearFilters,
  checklistNarrows,
  checklistSummary,
  normalizeName,
  normalizeTagSelection,
  pluralize,
  presetFilterCount,
  quickDateRange,
  todayInputValue,
  viewSummary,
  wniOptions,
} from "../../shared.js";

export function FilterBar({
  activeFilterCount,
  filterDefaults,
  filters,
  onClearFilters,
  onFilterChange,
  presets,
  refs,
  subcategoryOptions,
}) {
  const today = filterDefaults.to || todayInputValue();
  const activeRanges = activeQuickRanges(filters.date_from, filters.date_to, today, filterDefaults.from);
  const canClear = canClearFilters(filters, refs, filterDefaults);
  const checklists = [
    ["Accounts", "bank_account", refs.accounts.map((item) => [item.id, item.name])],
    ["Categories", "category", [[UNASSIGNED, "Unassigned category"], ...refs.categories.map((item) => [item.id, item.name])]],
    ["Subcategories", "subcategory", subcategoryOptions],
    ["WNI", "want_need_investment", [...wniOptions, [UNASSIGNED, "Unassigned"]]],
    ["Direction", "direction", [["income", "Incomes"], ["expense", "Expenses"]], { searchable: false }],
  ];
  const tagOptions = [[UNASSIGNED, "Untagged"], [ANY_TAG, "Tagged"], ...refs.tags.map((item) => [item.id, item.name])];

  // Through onFilterChange like every other filter, so an old Recategorize result goes too.
  function applyRange(id) {
    const range = quickDateRange(id, today, filterDefaults.from);
    onFilterChange("date_from", range.from);
    onFilterChange("date_to", range.to);
  }

  return (
    <section aria-label="Filters" className="filter-bar">
      <div className="filter-bar-row">
        <div aria-label="Date range" className="filter-dates" role="group">
          {[["From", "date_from"], ["To", "date_to"]].map(([label, name], index) => (
            <div className="filter-date" key={name}>
              {index ? <span aria-hidden="true" className="filter-dates-arrow">→</span> : null}
              <DateField
                firstYear={Number(filterDefaults.from.slice(0, 4)) || undefined}
                label={label}
                name={name}
                onChange={onFilterChange}
                rangeFrom={filters.date_from}
                rangeTo={filters.date_to}
                value={filters[name]}
              />
            </div>
          ))}
        </div>
        <div aria-label="Quick date ranges" className="quick-ranges" role="group">
          {QUICK_RANGES.map(([id, label]) => (
            <button
              aria-pressed={activeRanges.includes(id)}
              className={`quick-range ${activeRanges.includes(id) ? "is-active" : ""}`.trim()}
              key={id}
              onClick={() => applyRange(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="filter-search">
          <span className="visually-hidden">Search</span>
          <input onChange={(event) => onFilterChange("q", event.target.value)} placeholder="Search text" title="Searches the description, notes and counterparty" type="search" value={filters.q} />
        </label>
        <SavedFiltersMenu {...presets} dateDefaults={filterDefaults} refs={refs} />
      </div>
      <div className="filter-bar-row">
        {checklists.map(([label, name, options, settings = {}]) => (
          <FilterChip
            active={checklistNarrows(filters[name], options)}
            key={name}
            label={label}
            summary={checklistSummary(filters[name], options)}
          >
            <CheckboxFilterPanel
              label={label}
              name={name}
              onChange={onFilterChange}
              options={options}
              searchable={settings.searchable ?? true}
              value={filters[name]}
            />
          </FilterChip>
        ))}
        <FilterChip
          active={normalizeTagSelection(filters.tag, refs.tags).length > 0}
          label="Tags"
          summary={checklistSummary(normalizeTagSelection(filters.tag, refs.tags), tagOptions, { optional: true })}
        >
          <CheckboxFilterPanel label="Tag" name="tag" onChange={onFilterChange} optional options={tagOptions} tags={refs.tags} value={filters.tag} />
        </FilterChip>
        <FilterChip
          active={Boolean(filters.include_ignored) || filters.include_locked === false || filters.split_by_owners === false}
          label="View"
          summary={viewSummary(filters)}
        >
          <ViewOptions filters={filters} onFilterChange={onFilterChange} />
        </FilterChip>
        <span className="filter-bar-end">
          {activeFilterCount ? <span className="filter-active-count">{activeFilterCount} active</span> : null}
          <button className="text-button" disabled={!canClear} onClick={onClearFilters} type="button">Clear filters</button>
        </span>
      </div>
    </section>
  );
}

function FilterChip({ active, children, label, summary }) {
  return (
    <PopoverButton
      active={active}
      buttonProps={{ "data-filter-chip": label }}
      className="filter-chip"
      content={(
        <>
          <span className="filter-chip-label">{label}</span>
          <span className="filter-chip-value">{summary}</span>
          <ChevronIcon open size={14} />
        </>
      )}
      label={`${label} filter`}
      popoverClassName="filter-popover"
    >
      {children}
    </PopoverButton>
  );
}

function ViewOptions({ filters, onFilterChange }) {
  const options = [
    ["split_by_owners", "Divide by account owner count", "Divides account amounts by that account's owner count for dashboard totals and displayed transaction amounts."],
    ["include_ignored", "Include ignored transactions", "Includes transactions marked as ignored in the dashboard, charts, and transaction table."],
    ["include_locked", "Include locked transactions", "Includes transactions whose categorization is locked and protected from automatic recategorization."],
  ];
  return (
    <div className="view-options">
      {options.map(([name, label, help]) => (
        <div className="check-row" key={name}>
          <label className="check-row-label">
            <input checked={Boolean(filters[name])} onChange={(event) => onFilterChange(name, event.target.checked)} type="checkbox" />
            <span>{label}</span>
          </label>
          <HelpTooltip text={help} />
        </div>
      ))}
    </div>
  );
}

function SavedFiltersMenu({ busy, dateDefaults, items, name, onDelete, onLoad, onNameChange, onSave, refs }) {
  const nameRef = useRef(null);

  // The Save button is disabled while it saves, which drops focus: put it back in the
  // (now empty) name field.
  async function save(event) {
    await onSave(event);
    nameRef.current?.focus();
  }

  return (
    <PopoverButton
      buttonProps={{ "data-filter-menu": "saved" }}
      className="filter-menu-button"
      content={<>Saved filters <ChevronIcon open size={14} /></>}
      label="Saved filters"
      popoverClassName="saved-filters-popover"
    >
      {(close) => (
        <div className="saved-filters-menu">
          {items.length ? (
            <ul className="saved-filter-items">
              {items.map((preset) => (
                <li className="saved-filter-item" key={preset.id}>
                  <button
                    className="saved-filter-load"
                    disabled={busy}
                    onClick={() => {
                      onLoad(preset);
                      close();
                    }}
                    type="button"
                  >
                    <span>{preset.name}</span>
                    <small>{pluralize(presetFilterCount(preset.filters, refs, dateDefaults), "filter")}</small>
                  </button>
                  <button
                    aria-label={`Delete ${preset.name}`}
                    className="icon-button saved-filter-delete"
                    disabled={busy}
                    onClick={() => onDelete(preset.id)}
                    title={`Delete ${preset.name}`}
                    type="button"
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="saved-filter-empty">No saved filters yet.</p>
          )}
          <form className="saved-filter-save" onSubmit={save}>
            <input
              aria-label="Name for the current filters"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Name, e.g. Cash withdrawals"
              ref={nameRef}
              value={name}
            />
            <button className="link-button" disabled={busy} type="submit">Save current filters</button>
          </form>
        </div>
      )}
    </PopoverButton>
  );
}

// tags: show the options as tag pills (TagToggleList) in these tags' colours.
export function CheckboxFilterPanel({ className = "", label, name, onChange, optional = false, options, searchable = true, tags, value }) {
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
        <span className="filter-count">{selectedValues.length ? `${selectedValues.length} selected` : optional ? "Any" : "None"}</span>
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
          {optional ? null : (
            <button className="filter-clear" disabled={!canSelectAll} onClick={() => onChange(name, options.map(([optionValue]) => optionValue))} type="button">Select all</button>
          )}
          <button className="filter-clear" disabled={selectedValues.length === 0} onClick={() => onChange(name, [])} type="button">Clear</button>
        </div>
      </div>
      <div className="checkbox-filter-list">
        {!filteredOptions.length ? (
          <div className="filter-no-matches">No matches</div>
        ) : tags ? (
          <TagToggleList label={label} onToggle={toggleOption} options={filteredOptions} tags={tags} value={selectedValues} />
        ) : filteredOptions.map(([optionValue, text]) => (
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
