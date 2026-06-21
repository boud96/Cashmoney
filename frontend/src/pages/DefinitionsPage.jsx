import { useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiPatch, apiPost } from "../api.js";
import { LoadingButton, Select } from "../components.jsx";
import {
  categorizationFieldOptions,
  coerceArray,
  defaultCategorizationFields,
  defaultParsingSettings,
  definitionHelp,
  fieldLabel,
  findDuplicate,
  findDuplicateSubcategory,
  formObject,
  guessColumnMap,
  lines,
  mappedColumnOptions,
  mappingFields,
  normalizeHexColor,
  parsingSettingsFromMapping,
  sanitizeColumnMap,
  subLabel,
  titleCase,
  validateRequiredColumnMap,
  validateRequiredFields,
  wniOptions,
} from "../shared.js";

export default function DefinitionsPage({ mappingDraft, notify, refs, reloadAll, setMappingDraft }) {
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

  return (
    <div className="settings-grid">
      <section className="panel wide-panel">
        <div className="panel-header">
          <h2>App Settings</h2>
        </div>
        <SettingsForm notify={notify} refs={refs} reloadAll={reloadAll} settings={refs.settings} />
      </section>
      <DefinitionPanel endpoint="/csv-mappings/" formatter={(item) => [item.name, `${item.delimiter} - ${item.date_format}`]} helpText={definitionHelp["CSV Mappings"]} items={refs.mappings} notify={notify} onDeleted={() => clearEditing("/csv-mappings/")} onEdit={(item) => editItem("/csv-mappings/", item)} reloadAll={reloadAll} title="CSV Mappings" wide>
        <MappingForm clearEditing={() => clearEditing("/csv-mappings/")} draft={mappingDraft} editingItem={editingItems["/csv-mappings/"]} notify={notify} refs={refs} reloadAll={reloadAll} setDraft={setMappingDraft} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/bank-accounts/" formatter={(item) => [item.name, `${item.bank_name || "Bank"} - ${item.account_number}`]} helpText={definitionHelp["Bank Accounts"]} items={refs.accounts} notify={notify} onDeleted={() => clearEditing("/bank-accounts/")} onEdit={(item) => editItem("/bank-accounts/", item)} reloadAll={reloadAll} title="Bank Accounts">
        <AccountForm clearEditing={() => clearEditing("/bank-accounts/")} editingItem={editingItems["/bank-accounts/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/categories/" formatter={(item) => [item.name, item.description || ""]} helpText={definitionHelp.Categories} items={refs.categories} notify={notify} onDeleted={() => clearEditing("/categories/")} onEdit={(item) => editItem("/categories/", item)} reloadAll={reloadAll} title="Categories">
        <SimpleForm clearEditing={() => clearEditing("/categories/")} editingItem={editingItems["/categories/"]} endpoint="/categories/" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.categories} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/subcategories/" formatter={(item) => [item.name, item.category?.name || ""]} helpText={definitionHelp.Subcategories} items={refs.subcategories} notify={notify} onDeleted={() => clearEditing("/subcategories/")} onEdit={(item) => editItem("/subcategories/", item)} reloadAll={reloadAll} title="Subcategories">
        <SubcategoryForm clearEditing={() => clearEditing("/subcategories/")} editingItem={editingItems["/subcategories/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/tags/" formatter={(item) => [item.name, item.description || ""]} helpText={definitionHelp.Tags} items={refs.tags} notify={notify} onDeleted={() => clearEditing("/tags/")} onEdit={(item) => editItem("/tags/", item)} reloadAll={reloadAll} title="Tags">
        <SimpleForm clearEditing={() => clearEditing("/tags/")} editingItem={editingItems["/tags/"]} endpoint="/tags/" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.tags} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/keywords/" formatter={(item) => [item.name, `${(item.include_terms || []).join(", ")} - ${item.subcategory?.name || "No subcategory"} - ${item.want_need_investment || "No WNI"}`]} helpText={definitionHelp.Keywords} items={refs.keywords} notify={notify} onDeleted={() => clearEditing("/keywords/")} onEdit={(item) => editItem("/keywords/", item)} reloadAll={reloadAll} title="Keywords" wide>
        <KeywordForm clearEditing={() => clearEditing("/keywords/")} editingItem={editingItems["/keywords/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
    </div>
  );
}

function SettingsForm({ notify, refs, reloadAll, settings }) {
  const [saving, setSaving] = useState(false);
  const [ignoreInternalAccounts, setIgnoreInternalAccounts] = useState(
    settings?.ignore_internal_account_references ?? true,
  );
  const [internalTransferSubcategoryId, setInternalTransferSubcategoryId] = useState(
    settings?.internal_transfer_subcategory?.id || "",
  );

  useEffect(() => {
    setIgnoreInternalAccounts(settings?.ignore_internal_account_references ?? true);
    setInternalTransferSubcategoryId(settings?.internal_transfer_subcategory?.id || "");
  }, [settings]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiPatch("/settings/", {
        ignore_internal_account_references: ignoreInternalAccounts,
        internal_transfer_subcategory_id: internalTransferSubcategoryId,
      });
      notify("Settings saved");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compact-form app-settings-form" onSubmit={submit}>
      <label className="check-row">
        <input
          checked={ignoreInternalAccounts}
          onChange={(event) => setIgnoreInternalAccounts(event.target.checked)}
          type="checkbox"
        />
        <span>Set transactions as ignored that mention another configured bank account automatically</span>
      </label>
      <FormField label="Internal Transfer Subcategory">
        <Select
          blank="No automatic subcategory"
          name="internal_transfer_subcategory_id"
          onChange={(event) => setInternalTransferSubcategoryId(event.target.value)}
          options={refs.subcategories.map((item) => [item.id, subLabel(item)])}
          value={internalTransferSubcategoryId}
        />
      </FormField>
      <LoadingButton busy={saving} busyLabel="Saving" type="submit">Save</LoadingButton>
    </form>
  );
}

function DefinitionPanel({ children, endpoint, formatter, helpText, items, notify, onDeleted, onEdit, reloadAll, title, wide = false }) {
  return (
    <section className={`panel ${wide ? "wide-panel" : ""}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        {helpText && <HelpTooltip text={helpText} />}
      </div>
      {children}
      <div className="item-list">
        {items.length ? items.map((item) => {
          const [itemTitle, subtitle] = formatter(item);
          return (
            <div className="item-row" key={item.id}>
              <div>
                <div className="item-title">{itemTitle}</div>
                <div className="item-subtitle">{subtitle}</div>
              </div>
              <div className="item-actions">
                {item.color && <span className="swatch" style={{ background: item.color }} />}
                <button className="edit-button" onClick={() => onEdit(item)} type="button">Edit</button>
                <DeleteButton endpoint={`${endpoint}${item.id}/`} name={itemTitle} notify={notify} onDeleted={onDeleted} reloadAll={reloadAll} />
              </div>
            </div>
          );
        }) : <div className="muted">No records yet.</div>}
      </div>
    </section>
  );
}

function HelpTooltip({ text }) {
  return (
    <span className="help-tooltip">
      <button aria-label={text} className="help-tooltip-button" type="button">?</button>
      <span className="help-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

function DeleteButton({ endpoint, name, notify, onDeleted, reloadAll }) {
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete ${name}?`)) {
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

function FormActions({ busy = false, clearEditing, isEditing }) {
  return (
    <div className="form-actions">
      <LoadingButton busy={busy} busyLabel={isEditing ? "Saving" : "Adding"} type="submit">{isEditing ? "Save" : "Add"}</LoadingButton>
      {isEditing && <button className="link-button" disabled={busy} onClick={clearEditing} type="button">Cancel</button>}
    </div>
  );
}

function AccountForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    if (!validateRequiredFields(form, ["name", "account_number", "currency", "owners"], notify)) {
      return;
    }
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
    data.owners = Number(data.owners || 1);
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/bank-accounts/${editingItem.id}/`, data);
      } else {
        await apiPost("/bank-accounts/", data);
      }
      form.reset();
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
    <form className="compact-form" key={editingItem?.id || "new-account"} onSubmit={submit}>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Account name" required /></FormField>
      <FormField label="Account Number"><input defaultValue={editingItem?.account_number || ""} name="account_number" placeholder="Account number" required /></FormField>
      <FormField label="Bank"><input defaultValue={editingItem?.bank_name || ""} name="bank_name" placeholder="Bank name" /></FormField>
      <FormField label="Currency"><input defaultValue={editingItem?.currency || "CZK"} maxLength="3" name="currency" placeholder="CZK" required /></FormField>
      <FormField label="Owners"><input defaultValue={editingItem?.owners || "1"} min="1" name="owners" required type="number" /></FormField>
      <FormField label="Default CSV Mapping"><Select blank="No default mapping" defaultValue={editingItem?.default_csv_mapping?.id || ""} name="default_csv_mapping_id" options={refs.mappings.map((item) => [item.id, item.name])} /></FormField>
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
  );
}

function MappingForm({ clearEditing, draft, editingItem, notify, refs, reloadAll, setDraft }) {
  const headers = useMemo(
    () => mappedColumnOptions(draft.detected?.headers || draft.available_headers || [], draft.column_map),
    [draft.detected?.headers, draft.available_headers, draft.column_map],
  );
  const isEditing = Boolean(editingItem);
  const [parsingSettings, setParsingSettings] = useState(() => parsingSettingsFromMapping(editingItem));
  const [manualParsingSettings, setManualParsingSettings] = useState(Boolean(editingItem));
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingItem) {
      setParsingSettings(defaultParsingSettings);
      setManualParsingSettings(false);
      return;
    }
    setParsingSettings(parsingSettingsFromMapping(editingItem));
    setManualParsingSettings(true);
    setDraft({
      column_map: sanitizeColumnMap(editingItem.column_map || {}),
      categorization_fields: editingItem.categorization_fields?.length ? editingItem.categorization_fields : defaultCategorizationFields,
      available_headers: editingItem.available_headers || [],
      detected: null,
    });
  }, [editingItem, setDraft]);

  function updateParsingSetting(field, value) {
    setParsingSettings((current) => ({ ...current, [field]: value }));
    setManualParsingSettings(true);
  }

  async function detectColumns(event) {
    event.preventDefault();
    const form = event.currentTarget.form || event.currentTarget;
    const file = form.elements.sample_csv.files[0];
    if (!file) {
      notify("Choose a sample CSV");
      return;
    }
    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("default_currency", form.elements.default_currency?.value || "CZK");
    if (manualParsingSettings) {
      formData.append("manual_settings", "1");
      Object.entries(parsingSettings).forEach(([field, value]) => {
        formData.append(field, value ?? "");
      });
    }
    formData.append("sample_size", "5");
    setDetecting(true);
    try {
      const response = await fetch("/api/csv-mappings/detect-columns/", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Column detection failed");
      }
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

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const duplicateMapping = findDuplicate(refs.mappings, "name", data.name, editingItem?.id);
    data.header_row = Number(data.header_row || 0);
    data.column_map = sanitizeColumnMap(draft.column_map);
    data.categorization_fields = draft.categorization_fields;
    data.fallback_date_formats = [];
    if (duplicateMapping) {
      notify("CSV mapping name already exists");
      form.elements.name?.focus();
      return;
    }
    if (!validateRequiredFields(form, ["default_currency", "delimiter", "quotechar", "encoding", "date_format", "decimal_separator"], notify)) {
      return;
    }
    if (!validateRequiredColumnMap(draft.column_map, notify)) {
      return;
    }
    if (!draft.categorization_fields.length) {
      notify("Choose at least one categorization field");
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/csv-mappings/${editingItem.id}/`, data);
      } else {
        await apiPost("/csv-mappings/", data);
      }
      form.reset();
      clearEditing?.();
      setParsingSettings(defaultParsingSettings);
      setManualParsingSettings(false);
      setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, available_headers: [], detected: null });
      notify(isEditing ? "CSV mapping saved" : "CSV mapping added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compact-form mapping-form" key={editingItem?.id || "new-mapping"} onSubmit={submit}>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Mapping name" required /></FormField>
      <FormField label="Default Currency"><input defaultValue={editingItem?.default_currency || "CZK"} maxLength="3" name="default_currency" placeholder="CZK" required /></FormField>
      <label className="mapping-file-field"><span>Sample CSV</span><input accept=".csv,text/csv" name="sample_csv" type="file" /></label>
      <LoadingButton busy={detecting} busyLabel="Detecting" className="link-button mapping-detect-button" disabled={saving} onClick={detectColumns} type="button">Detect Columns</LoadingButton>
      <details className="advanced-settings" open={isEditing || Boolean(draft.detected)}>
        <summary>Advanced parsing settings</summary>
        <div className="advanced-settings-grid">
          <FormField label="Delimiter"><input maxLength="1" name="delimiter" onChange={(event) => updateParsingSetting("delimiter", event.target.value)} placeholder="," required value={parsingSettings.delimiter} /></FormField>
          <FormField label="Date Format"><input name="date_format" onChange={(event) => updateParsingSetting("date_format", event.target.value)} placeholder="%Y-%m-%d" required value={parsingSettings.date_format} /></FormField>
          <FormField label="Encoding"><input name="encoding" onChange={(event) => updateParsingSetting("encoding", event.target.value)} placeholder="utf-8-sig" required value={parsingSettings.encoding} /></FormField>
          <FormField label="Header Row"><input min="0" name="header_row" onChange={(event) => updateParsingSetting("header_row", event.target.value)} placeholder="0" required type="number" value={parsingSettings.header_row} /></FormField>
          <FormField label="Quote Character"><input maxLength="1" name="quotechar" onChange={(event) => updateParsingSetting("quotechar", event.target.value)} placeholder={'"'} required value={parsingSettings.quotechar} /></FormField>
          <FormField label="Decimal Separator"><input maxLength="1" name="decimal_separator" onChange={(event) => updateParsingSetting("decimal_separator", event.target.value)} placeholder="." required value={parsingSettings.decimal_separator} /></FormField>
          <FormField label="Thousands Separator"><input name="thousands_separator" onChange={(event) => updateParsingSetting("thousands_separator", event.target.value)} placeholder="Optional" value={parsingSettings.thousands_separator} /></FormField>
        </div>
      </details>
      {draft.detected?.warnings?.length ? (
        <div className="mapping-warnings">
          {draft.detected.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      ) : null}
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
                required={["transaction_date", "amount"].includes(key)}
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
      <DefinitionCheckboxField
        className="mapping-categorization-field"
        label="Categorization Fields"
        helpText="Keywords and recategorization build their matching text from these transaction fields. Select every field that can contain useful merchant, counterparty, note, symbol, or transaction-type text."
        onChange={(next) => setDraft((current) => ({ ...current, categorization_fields: next }))}
        options={categorizationFieldOptions}
        placeholder="No categorization fields selected"
        value={draft.categorization_fields}
      />
      {draft.detected && <MappingSample detected={draft.detected} />}
      <FormActions busy={saving} clearEditing={() => {
        clearEditing?.();
        setParsingSettings(defaultParsingSettings);
        setManualParsingSettings(false);
        setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, available_headers: [], detected: null });
      }} isEditing={isEditing} />
    </form>
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

function SimpleForm({ clearEditing, editingItem, endpoint, fields, items = [], notify, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [saving, setSaving] = useState(false);
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
      clearEditing?.();
      notify(isEditing ? "Record saved" : "Record added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="compact-form" key={editingItem?.id || `${endpoint}-new`} onSubmit={submit}>
      {fields.map(([name, placeholder, required]) => (
        name === "color"
          ? <ColorInput initialValue={editingItem?.[name] || ""} key={name} label={placeholder} name={name} />
          : <FormField key={name} label={placeholder}><input defaultValue={editingItem?.[name] || ""} name={name} placeholder={placeholder} required={required} /></FormField>
      ))}
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
  );
}

function SubcategoryForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [saving, setSaving] = useState(false);
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
    <form className="compact-form" key={editingItem?.id || "new-subcategory"} onSubmit={submit}>
      <FormField label="Category"><Select defaultValue={editingItem?.category?.id || ""} name="category_id" options={refs.categories.map((item) => [item.id, item.name])} required /></FormField>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Subcategory name" required /></FormField>
      <ColorInput initialValue={editingItem?.color || ""} label="Color" name="color" />
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
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

function DefinitionCheckboxField({ className = "", helpText = "", label, onChange, options, placeholder = "None selected", value }) {
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
        {options.length ? options.map(([optionValue, text]) => (
          <label className="checkbox-filter-row" key={optionValue} title={text}>
            <input
              checked={selectedSet.has(optionValue)}
              onChange={() => toggleOption(optionValue)}
              type="checkbox"
            />
            <span>{text}</span>
          </label>
        )) : <div className="filter-no-matches">No options</div>}
      </div>
    </div>
  );
}

function KeywordForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const isEditing = Boolean(editingItem);
  const [tagIds, setTagIds] = useState(() => (editingItem?.tags || []).map((item) => item.id));
  const [previewResult, setPreviewResult] = useState(null);
  const [previewText, setPreviewText] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTagIds((editingItem?.tags || []).map((item) => item.id));
    setPreviewResult(null);
    setPreviewText("");
  }, [editingItem]);

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
      clearEditing?.();
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
    <form className="compact-form keyword-form" key={editingItem?.id || "new-keyword"} onSubmit={submit}>
      <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Keyword name" required /></FormField>
      <FormField label="Include Terms"><textarea defaultValue={(editingItem?.include_terms || []).join("\n")} name="include_terms" placeholder="One term per line" required rows="3" /></FormField>
      <FormField label="Exclude Terms"><textarea defaultValue={(editingItem?.exclude_terms || []).join("\n")} name="exclude_terms" placeholder="One term per line" rows="3" /></FormField>
      <FormField label="Subcategory"><Select blank="No subcategory" defaultValue={editingItem?.subcategory?.id || ""} name="subcategory_id" options={refs.subcategories.map((item) => [item.id, subLabel(item)])} /></FormField>
      <FormField label="Want / Need / Investment"><Select blank="No WNI" defaultValue={editingItem?.want_need_investment || ""} name="want_need_investment" options={wniOptions} /></FormField>
      <DefinitionCheckboxField label="Tags" onChange={setTagIds} options={refs.tags.map((item) => [item.id, item.name])} placeholder="No tags selected" value={tagIds} />
      <FormField label="Priority"><input defaultValue={editingItem?.priority ?? "0"} name="priority" type="number" /></FormField>
      <label className="check-row"><input defaultChecked={Boolean(editingItem?.is_ignored)} name="is_ignored" type="checkbox" /><span>Ignore matches</span></label>
      <div className="keyword-preview-panel">
        <FormField label="Preview Text"><textarea onChange={(event) => setPreviewText(event.target.value)} placeholder="Paste transaction text" rows="2" value={previewText} /></FormField>
        <LoadingButton busy={previewing} busyLabel="Previewing" className="link-button" onClick={previewKeywordMatch} type="button">Preview Matches</LoadingButton>
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
      <FormActions busy={saving} clearEditing={clearEditing} isEditing={isEditing} />
    </form>
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
