// The dashboard's filter controls.
import { useMemo, useState } from "react";

import { TagToggleList } from "../../components.jsx";
import { formatCount, formatDateInput, normalizeName, presetFilterCount, subtractRelativeDate } from "../../shared.js";

export function RelativeRangeForm({ setFilters }) {
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

export function SavedFiltersPanel({ busy, dateDefaults, name, onDelete, onLoad, onNameChange, onSave, presets, refs }) {
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
              <small>{formatCount(presetFilterCount(preset.filters, refs, dateDefaults))} filters</small>
            </button>
            <button aria-label={`Delete ${preset.name}`} className="icon-button" disabled={busy} onClick={() => onDelete(preset.id)} type="button">x</button>
          </div>
        )) : <div className="saved-filter-empty">No saved filters yet</div>}
      </div>
    </div>
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
