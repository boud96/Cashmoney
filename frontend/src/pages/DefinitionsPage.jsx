import { useEffect, useMemo, useRef, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost } from "../api.js";
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

const defaultCurrencyOptions = [
  { code: "CZK", name: "Czech Koruna" },
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "United States Dollar" },
  { code: "GBP", name: "British Pound" },
];

export default function DefinitionsPage({ mappingDraft, notify, refs, reloadAll, reloadDashboard, setMappingDraft }) {
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
        <SettingsForm notify={notify} refs={refs} reloadAll={reloadAll} reloadDashboard={reloadDashboard} settings={refs.settings} />
      </section>
      <DefinitionPanel endpoint="/csv-mappings/" formatter={(item) => [item.name, `${item.delimiter} - ${item.date_format}`]} helpText={definitionHelp["CSV Mappings"]} items={refs.mappings} notify={notify} onDeleted={() => clearEditing("/csv-mappings/")} onEdit={(item) => editItem("/csv-mappings/", item)} reloadAll={reloadAll} title="CSV Mappings" wide>
        <MappingForm clearEditing={() => clearEditing("/csv-mappings/")} draft={mappingDraft} editingItem={editingItems["/csv-mappings/"]} notify={notify} refs={refs} reloadAll={reloadAll} setDraft={setMappingDraft} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/bank-accounts/" formatter={(item) => [item.name, bankAccountSubtitle(item)]} helpText={definitionHelp["Bank Accounts"]} items={refs.accounts} notify={notify} onDeleted={() => clearEditing("/bank-accounts/")} onEdit={(item) => editItem("/bank-accounts/", item)} reloadAll={reloadAll} title="Bank Accounts">
        <AccountForm clearEditing={() => clearEditing("/bank-accounts/")} editingItem={editingItems["/bank-accounts/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/categories/" formatter={(item) => [item.name, item.description || ""]} helpText={definitionHelp.Categories} items={refs.categories} notify={notify} onDeleted={() => clearEditing("/categories/")} onEdit={(item) => editItem("/categories/", item)} reloadAll={reloadAll} title="Categories">
        <SimpleForm clearEditing={() => clearEditing("/categories/")} editingItem={editingItems["/categories/"]} endpoint="/categories/" entityLabel="Category" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.categories} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/subcategories/" formatter={(item) => [item.name, item.category?.name || ""]} helpText={definitionHelp.Subcategories} items={refs.subcategories} notify={notify} onDeleted={() => clearEditing("/subcategories/")} onEdit={(item) => editItem("/subcategories/", item)} reloadAll={reloadAll} title="Subcategories">
        <SubcategoryForm clearEditing={() => clearEditing("/subcategories/")} editingItem={editingItems["/subcategories/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/tags/" formatter={(item) => [item.name, item.description || ""]} helpText={definitionHelp.Tags} items={refs.tags} notify={notify} onDeleted={() => clearEditing("/tags/")} onEdit={(item) => editItem("/tags/", item)} reloadAll={reloadAll} title="Tags">
        <SimpleForm clearEditing={() => clearEditing("/tags/")} editingItem={editingItems["/tags/"]} endpoint="/tags/" entityLabel="Tag" fields={[["name", "Name", true], ["color", "Color"], ["description", "Description"]]} items={refs.tags} notify={notify} reloadAll={reloadAll} />
      </DefinitionPanel>
      <DefinitionPanel endpoint="/keywords/" formatter={(item) => [item.name, `${(item.include_terms || []).join(", ")} - ${item.subcategory?.name || "No subcategory"} - ${item.want_need_investment || "No WNI"}`]} helpText={definitionHelp.Keywords} items={refs.keywords} notify={notify} onDeleted={() => clearEditing("/keywords/")} onEdit={(item) => editItem("/keywords/", item)} reloadAll={reloadAll} title="Keywords" wide>
        <KeywordForm clearEditing={() => clearEditing("/keywords/")} editingItem={editingItems["/keywords/"]} notify={notify} refs={refs} reloadAll={reloadAll} />
      </DefinitionPanel>
    </div>
  );
}

function SettingsForm({ notify, refs, reloadAll, reloadDashboard, settings }) {
  const [saving, setSaving] = useState(false);
  const [syncingRates, setSyncingRates] = useState(false);
  const [rateStatus, setRateStatus] = useState(null);
  const [currencyOptions, setCurrencyOptions] = useState(defaultCurrencyOptions);
  const [currencyOptionsFallback, setCurrencyOptionsFallback] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState(settings?.default_currency || "CZK");
  const [ignoreInternalAccounts, setIgnoreInternalAccounts] = useState(
    settings?.ignore_internal_account_references ?? true,
  );
  const [internalTransferSubcategoryId, setInternalTransferSubcategoryId] = useState(
    settings?.internal_transfer_subcategory?.id || "",
  );
  const missingRateCount = Number(rateStatus?.missing_converted_transactions || 0);

  useEffect(() => {
    const nextCurrency = settings?.default_currency || "CZK";
    setDefaultCurrency(nextCurrency);
    setCurrencyOptions((current) => ensureCurrencyOption(current, nextCurrency));
    setIgnoreInternalAccounts(settings?.ignore_internal_account_references ?? true);
    setInternalTransferSubcategoryId(settings?.internal_transfer_subcategory?.id || "");
  }, [settings]);

  async function loadRateStatus() {
    try {
      setRateStatus(await apiGet("/exchange-rates/status/"));
    } catch (error) {
      notify(error.message);
    }
  }

  useEffect(() => {
    loadRateStatus();
    loadCurrencyOptions();
  }, []);

  async function loadCurrencyOptions() {
    try {
      const payload = await apiGet("/exchange-rates/currencies/");
      const currentCode = normalizeCurrencyCode(settings?.default_currency || defaultCurrency || "CZK");
      const options = payload.currencies || [];
      setCurrencyOptions(ensureCurrencyOption(options, currentCode));
      setCurrencyOptionsFallback(Boolean(payload.fallback));
    } catch (error) {
      notify(error.message);
    }
  }

  async function refreshAfterCurrencyChange() {
    await Promise.all([
      reloadAll(),
      reloadDashboard ? reloadDashboard() : Promise.resolve(),
      loadRateStatus(),
    ]);
  }

  async function syncExchangeRates(showNotification = true) {
    setSyncingRates(true);
    try {
      const result = await apiPost("/exchange-rates/sync/");
      const createdRates = Number(result.created_rates || 0).toLocaleString();
      const recalculated = Number(result.recalculation?.updated || 0).toLocaleString();
      if (showNotification) {
        notify(`${createdRates} rates downloaded, ${recalculated} transactions recalculated`);
      }
      await refreshAfterCurrencyChange();
      return result;
    } finally {
      setSyncingRates(false);
    }
  }

  async function handleSyncExchangeRates() {
    try {
      await syncExchangeRates();
    } catch (error) {
      notify(error.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const nextDefaultCurrency = normalizeCurrencyCode(defaultCurrency);
    if (nextDefaultCurrency.length !== 3) {
      notify("Default currency must be a three-letter code");
      return;
    }
    const previousDefaultCurrency = settings?.default_currency || "CZK";
    setSaving(true);
    try {
      await apiPatch("/settings/", {
        default_currency: nextDefaultCurrency,
        ignore_internal_account_references: ignoreInternalAccounts,
        internal_transfer_subcategory_id: internalTransferSubcategoryId,
      });
      if (nextDefaultCurrency !== previousDefaultCurrency) {
        try {
          const result = await syncExchangeRates(false);
          notify(`${Number(result.created_rates || 0).toLocaleString()} rates downloaded, default currency changed to ${nextDefaultCurrency}`);
        } catch (error) {
          notify(`Settings saved, but rate sync failed: ${error.message}`);
          await refreshAfterCurrencyChange();
        }
      } else {
        notify("Settings saved");
        await refreshAfterCurrencyChange();
      }
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compact-form app-settings-form" onSubmit={submit}>
      <FormField label="Default Currency">
        <Select
          name="default_currency"
          onChange={(event) => setDefaultCurrency(normalizeCurrencyCode(event.target.value))}
          options={currencyOptions.map((currency) => [
            currency.code,
            `${currency.code} - ${currency.name}`,
          ])}
          required
          value={defaultCurrency}
        />
      </FormField>
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
      {missingRateCount ? (
        <LoadingButton busy={syncingRates} busyLabel="Retrying" onClick={handleSyncExchangeRates} type="button">
          Retry Rate Sync
        </LoadingButton>
      ) : null}
      <div className="exchange-rate-status">
        <span>FX cache</span>
        <strong>{formatExchangeRateStatus(rateStatus)}</strong>
        {missingRateCount ? (
          <span className="warning-text">
            {missingRateCount.toLocaleString()} transactions need rates
          </span>
        ) : currencyOptionsFallback ? (
          <span className="warning-text">Currency list is using fallback options.</span>
        ) : (
          <span className="muted">Rates sync automatically after imports and default currency changes.</span>
        )}
      </div>
    </form>
  );
}

function normalizeCurrencyCode(value) {
  return String(value || "").replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3);
}

function ensureCurrencyOption(options, code) {
  const normalizedCode = normalizeCurrencyCode(code || "CZK");
  const normalizedOptions = (options || []).map((option) => ({
    code: normalizeCurrencyCode(option.code),
    name: option.name || option.code,
  })).filter((option) => option.code);
  if (normalizedOptions.some((option) => option.code === normalizedCode)) {
    return normalizedOptions;
  }
  return [{ code: normalizedCode, name: normalizedCode }, ...normalizedOptions];
}

function formatExchangeRateStatus(status) {
  if (!status) {
    return "Loading";
  }
  const count = Number(status.cached_rate_count || 0).toLocaleString();
  if (!status.latest_cached_rate_date) {
    return `${count} cached rates`;
  }
  return `${count} cached rates through ${status.latest_cached_rate_date}`;
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

function AccountForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setIsAdding(false);
    }
  }, [editingItem]);

  function openAddAccount() {
    clearEditing?.();
    setIsAdding(true);
  }

  function closeAccountModal() {
    if (saving) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    if (!validateRequiredFields(form, ["name", "currency", "owners"], notify)) {
      return;
    }
    if (data.account_number) {
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
      setIsAdding(false);
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
    <>
      <div className="definition-panel-actions">
        <button className="primary-action" onClick={openAddAccount} type="button">Add Bank Account</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeAccountModal()} role="presentation">
          <form aria-labelledby="account-modal-title" aria-modal="true" className="definition-modal" key={editingItem?.id || "new-account"} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id="account-modal-title">{isEditing ? "Edit Bank Account" : "Add Bank Account"}</h3>
                <span>{editingItem?.name || "New bank account"}</span>
              </div>
              <button aria-label="Close" className="icon-button" disabled={saving} onClick={closeAccountModal} type="button">x</button>
            </div>
            <div className="definition-modal-body">
              <div className="compact-form">
                <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Account name" required /></FormField>
                <FormField label="Account Number"><input defaultValue={editingItem?.account_number || ""} name="account_number" placeholder="Optional account number" /></FormField>
                <FormField label="Bank"><input defaultValue={editingItem?.bank_name || ""} name="bank_name" placeholder="Bank name" /></FormField>
                <FormField label="Currency"><input defaultValue={editingItem?.currency || "CZK"} maxLength="3" name="currency" placeholder="CZK" required /></FormField>
                <FormField label="Owners"><input defaultValue={editingItem?.owners || "1"} min="1" name="owners" required type="number" /></FormField>
                <FormField label="Default CSV Mapping"><Select blank="No default mapping" defaultValue={editingItem?.default_csv_mapping?.id || ""} name="default_csv_mapping_id" options={refs.mappings.map((item) => [item.id, item.name])} /></FormField>
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button" disabled={saving} onClick={closeAccountModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" type="submit">
                {isEditing ? "Save Account" : "Create Account"}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function bankAccountSubtitle(item) {
  const parts = [item.bank_name || "Bank"];
  parts.push(item.account_number || "No account number");
  return parts.join(" - ");
}

const mappingWizardSteps = ["Source", "Parsing", "Columns", "Confirm"];

function MappingForm({ clearEditing, draft, editingItem, notify, refs, reloadAll, setDraft }) {
  const [isAdding, setIsAdding] = useState(false);
  const [step, setStep] = useState(0);
  const [mappingDetails, setMappingDetails] = useState({ name: "", default_currency: "CZK" });
  const [sampleFile, setSampleFile] = useState(null);
  const formRef = useRef(null);
  const sampleFileRef = useRef(null);
  const headers = useMemo(
    () => mappedColumnOptions(draft.detected?.headers || draft.available_headers || [], draft.column_map),
    [draft.detected?.headers, draft.available_headers, draft.column_map],
  );
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const currentStep = Math.min(step, mappingWizardSteps.length - 1);
  const [parsingSettings, setParsingSettings] = useState(() => parsingSettingsFromMapping(editingItem));
  const [manualParsingSettings, setManualParsingSettings] = useState(Boolean(editingItem));
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingItem) {
      if (!isAdding) {
        resetWizardState();
      }
      return;
    }
    setIsAdding(false);
    setStep(0);
    setMappingDetails({
      name: editingItem.name || "",
      default_currency: normalizeCurrencyCode(editingItem.default_currency || "CZK"),
    });
    setParsingSettings(parsingSettingsFromMapping(editingItem));
    setManualParsingSettings(true);
    setDraft({
      column_map: sanitizeColumnMap(editingItem.column_map || {}),
      categorization_fields: editingItem.categorization_fields?.length ? editingItem.categorization_fields : defaultCategorizationFields,
      available_headers: editingItem.available_headers || [],
      detected: null,
    });
  }, [editingItem, isAdding, setDraft]);

  function resetWizardState() {
    setStep(0);
    setMappingDetails({ name: "", default_currency: "CZK" });
    setSampleFile(null);
    setParsingSettings(defaultParsingSettings);
    setManualParsingSettings(false);
    setDraft({ column_map: {}, categorization_fields: defaultCategorizationFields, available_headers: [], detected: null });
    if (sampleFileRef.current) {
      sampleFileRef.current.value = "";
    }
  }

  function openAddWizard() {
    clearEditing?.();
    resetWizardState();
    setIsAdding(true);
  }

  function closeWizard() {
    if (saving || detecting) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
    resetWizardState();
  }

  function updateMappingDetail(field, value) {
    setMappingDetails((current) => ({
      ...current,
      [field]: field === "default_currency" ? normalizeCurrencyCode(value) : value,
    }));
  }

  function updateParsingSetting(field, value) {
    setParsingSettings((current) => ({ ...current, [field]: value }));
    setManualParsingSettings(true);
  }

  async function detectColumns(event) {
    event.preventDefault();
    const file = sampleFileRef.current?.files?.[0] || sampleFile;
    if (!file) {
      notify("Choose a sample CSV");
      return;
    }
    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("default_currency", mappingDetails.default_currency || "CZK");
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

  function validateSourceStep() {
    const name = mappingDetails.name.trim();
    const currency = normalizeCurrencyCode(mappingDetails.default_currency);
    if (!name) {
      setStep(0);
      notify("Name is required");
      formRef.current?.elements.name?.focus();
      return false;
    }
    if (currency.length !== 3) {
      setStep(0);
      notify("Default currency must be a 3-letter code");
      formRef.current?.elements.default_currency?.focus();
      return false;
    }
    if (findDuplicate(refs.mappings, "name", name, editingItem?.id)) {
      setStep(0);
      notify("CSV mapping name already exists");
      formRef.current?.elements.name?.focus();
      return false;
    }
    return true;
  }

  function validateParsingStep() {
    const requiredSettings = [
      ["delimiter", "Delimiter"],
      ["quotechar", "Quote character"],
      ["encoding", "Encoding"],
      ["date_format", "Date format"],
      ["decimal_separator", "Decimal separator"],
    ];
    const missing = requiredSettings.find(([field]) => !String(parsingSettings[field] ?? "").trim());
    if (missing) {
      setStep(1);
      notify(`${missing[1]} is required`);
      return false;
    }
    if (!String(parsingSettings.header_row ?? "").trim()) {
      setStep(1);
      notify("Header row is required");
      return false;
    }
    const headerRow = Number(parsingSettings.header_row);
    if (!Number.isInteger(headerRow) || headerRow < 0) {
      setStep(1);
      notify("Header row must be zero or greater");
      return false;
    }
    return true;
  }

  function validateColumnsStep() {
    if (!validateRequiredColumnMap(draft.column_map, notify)) {
      setStep(2);
      return false;
    }
    if (!draft.categorization_fields.length) {
      setStep(2);
      notify("Choose at least one categorization field");
      return false;
    }
    return true;
  }

  function goNext() {
    const validators = [validateSourceStep, validateParsingStep, validateColumnsStep];
    if (validators[currentStep]?.() === false) {
      return;
    }
    setStep((value) => Math.min(value + 1, mappingWizardSteps.length - 1));
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (currentStep < mappingWizardSteps.length - 1) {
      goNext();
      return;
    }
    if (!validateSourceStep() || !validateParsingStep() || !validateColumnsStep()) {
      return;
    }
    const data = {
      name: mappingDetails.name.trim(),
      default_currency: normalizeCurrencyCode(mappingDetails.default_currency),
      delimiter: parsingSettings.delimiter,
      quotechar: parsingSettings.quotechar,
      encoding: parsingSettings.encoding,
      header_row: Number(parsingSettings.header_row || 0),
      date_format: parsingSettings.date_format,
      decimal_separator: parsingSettings.decimal_separator,
      thousands_separator: parsingSettings.thousands_separator || "",
      column_map: sanitizeColumnMap(draft.column_map),
      categorization_fields: draft.categorization_fields,
      fallback_date_formats: [],
    };
    setSaving(true);
    try {
      if (isEditing) {
        await apiPatch(`/csv-mappings/${editingItem.id}/`, data);
      } else {
        await apiPost("/csv-mappings/", data);
      }
      form.reset();
      setIsAdding(false);
      clearEditing?.();
      resetWizardState();
      notify(isEditing ? "CSV mapping saved" : "CSV mapping added");
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  function renderStepContent() {
    if (currentStep === 0) {
      return (
        <div className="mapping-wizard-step-panel">
          <div className="mapping-wizard-grid">
            <FormField label="Name">
              <input
                name="name"
                onChange={(event) => updateMappingDetail("name", event.target.value)}
                placeholder="Mapping name"
                value={mappingDetails.name}
              />
            </FormField>
            <FormField label="Default Currency">
              <input
                maxLength="3"
                name="default_currency"
                onChange={(event) => updateMappingDetail("default_currency", event.target.value)}
                placeholder="CZK"
                value={mappingDetails.default_currency}
              />
            </FormField>
            <label className="mapping-file-field">
              <span>Sample CSV</span>
              <input accept=".csv,text/csv" name="sample_csv" onChange={(event) => setSampleFile(event.target.files?.[0] || null)} ref={sampleFileRef} type="file" />
            </label>
          </div>
        </div>
      );
    }
    if (currentStep === 1) {
      return (
        <div className="mapping-wizard-step-panel">
          <div className="advanced-settings-grid mapping-wizard-parsing-grid">
            <FormField label="Delimiter"><input maxLength="1" name="delimiter" onChange={(event) => updateParsingSetting("delimiter", event.target.value)} placeholder="," value={parsingSettings.delimiter} /></FormField>
            <FormField label="Date Format"><input name="date_format" onChange={(event) => updateParsingSetting("date_format", event.target.value)} placeholder="%Y-%m-%d" value={parsingSettings.date_format} /></FormField>
            <FormField label="Encoding"><input name="encoding" onChange={(event) => updateParsingSetting("encoding", event.target.value)} placeholder="utf-8-sig" value={parsingSettings.encoding} /></FormField>
            <FormField label="Header Row"><input min="0" name="header_row" onChange={(event) => updateParsingSetting("header_row", event.target.value)} placeholder="0" type="number" value={parsingSettings.header_row} /></FormField>
            <FormField label="Quote Character"><input maxLength="1" name="quotechar" onChange={(event) => updateParsingSetting("quotechar", event.target.value)} placeholder={'"'} value={parsingSettings.quotechar} /></FormField>
            <FormField label="Decimal Separator"><input maxLength="1" name="decimal_separator" onChange={(event) => updateParsingSetting("decimal_separator", event.target.value)} placeholder="." value={parsingSettings.decimal_separator} /></FormField>
            <FormField label="Thousands Separator"><input name="thousands_separator" onChange={(event) => updateParsingSetting("thousands_separator", event.target.value)} placeholder="Optional" value={parsingSettings.thousands_separator} /></FormField>
            <div className="mapping-parser-action">
              <LoadingButton busy={detecting} busyLabel="Detecting" className="link-button mapping-detect-button" disabled={saving} onClick={detectColumns} type="button">Detect Columns</LoadingButton>
              {draft.detected ? <span className="mapping-detection-status">{draft.detected.headers?.length || 0} columns detected</span> : null}
            </div>
          </div>
        </div>
      );
    }
    if (currentStep === 2) {
      return (
        <div className="mapping-wizard-step-panel">
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
        </div>
      );
    }
    return (
      <MappingReview
        draft={draft}
        headers={headers}
        mappingDetails={mappingDetails}
        parsingSettings={parsingSettings}
      />
    );
  }

  function renderSamplePreview() {
    return (
      <div className="mapping-wizard-sample">
        {draft.detected?.warnings?.length ? (
          <div className="mapping-warnings">
            {draft.detected.warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        ) : null}
        {draft.detected ? <MappingSample detected={draft.detected} /> : <div className="mapping-empty-state">No sample data detected.</div>}
      </div>
    );
  }

  return (
    <>
      <div className="mapping-panel-actions">
        <button className="primary-action" onClick={openAddWizard} type="button">Add CSV Mapping</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeWizard()} role="presentation">
          <form aria-labelledby="mapping-wizard-title" aria-modal="true" className="mapping-wizard-modal" key={editingItem?.id || "new-mapping"} onSubmit={submit} ref={formRef} role="dialog">
            <div className="mapping-wizard-header">
              <div>
                <h3 id="mapping-wizard-title">{isEditing ? "Edit CSV Mapping" : "Add CSV Mapping"}</h3>
                <span>{mappingDetails.name || "New mapping"}</span>
              </div>
              <button aria-label="Close" className="icon-button" disabled={saving || detecting} onClick={closeWizard} type="button">x</button>
            </div>
            <div aria-label="CSV mapping steps" className="mapping-wizard-steps">
              {mappingWizardSteps.map((label, index) => (
                <div className={`mapping-wizard-step ${index === currentStep ? "is-active" : ""} ${index < currentStep ? "is-complete" : ""}`.trim()} key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
            <div className="mapping-wizard-body">
              <h4>{mappingWizardSteps[currentStep]}</h4>
              {renderStepContent()}
              {renderSamplePreview()}
            </div>
            <div className="mapping-wizard-actions">
              <button className="link-button" disabled={saving || detecting} onClick={closeWizard} type="button">Cancel</button>
              <button className="link-button mapping-back-button" disabled={currentStep === 0 || saving || detecting} onClick={() => setStep((value) => Math.max(value - 1, 0))} type="button">Back</button>
              {currentStep < mappingWizardSteps.length - 1 ? (
                <button className="primary-action" disabled={saving || detecting} onClick={goNext} type="button">Next</button>
              ) : (
                <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" disabled={detecting} type="submit">
                  {isEditing ? "Save Mapping" : "Create Mapping"}
                </LoadingButton>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function MappingReview({ draft, headers, mappingDetails, parsingSettings }) {
  const mappedFields = mappingFields
    .map(([key, label]) => [label, coerceArray(draft.column_map[key]).filter(Boolean).join(", ")])
    .filter(([, value]) => value);
  return (
    <div className="mapping-review">
      <div className="mapping-review-grid">
        <div><span>Name</span><strong>{mappingDetails.name || "Unnamed"}</strong></div>
        <div><span>Default currency</span><strong>{mappingDetails.default_currency || "CZK"}</strong></div>
        <div><span>Detected columns</span><strong>{headers.length}</strong></div>
        <div><span>Date format</span><strong>{parsingSettings.date_format}</strong></div>
        <div><span>Delimiter</span><strong>{parsingSettings.delimiter}</strong></div>
        <div><span>Encoding</span><strong>{parsingSettings.encoding}</strong></div>
      </div>
      <div className="mapping-review-section">
        <span>Column map</span>
        <div className="mapping-review-list">
          {mappedFields.length ? mappedFields.map(([label, value]) => (
            <div key={label}><strong>{label}</strong><span>{value}</span></div>
          )) : <div className="muted">No columns mapped.</div>}
        </div>
      </div>
      <div className="mapping-review-section">
        <span>Categorization fields</span>
        <div className="mapping-review-tags">
          {draft.categorization_fields.length ? draft.categorization_fields.map((field) => (
            <span key={field}>{fieldLabel(field)}</span>
          )) : <span className="muted">None selected.</span>}
        </div>
      </div>
    </div>
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

function SimpleForm({ clearEditing, editingItem, endpoint, entityLabel = "Record", fields, items = [], notify, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setIsAdding(false);
    }
  }, [editingItem]);

  function openAddItem() {
    clearEditing?.();
    setIsAdding(true);
  }

  function closeItemModal() {
    if (saving) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
  }

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
      setIsAdding(false);
      clearEditing?.();
      notify(isEditing ? `${entityLabel} saved` : `${entityLabel} added`);
      await reloadAll();
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="definition-panel-actions">
        <button className="primary-action" onClick={openAddItem} type="button">Add {entityLabel}</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeItemModal()} role="presentation">
          <form aria-labelledby={`${endpoint.replace(/\W/g, "")}-modal-title`} aria-modal="true" className="definition-modal" key={editingItem?.id || `${endpoint}-new`} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id={`${endpoint.replace(/\W/g, "")}-modal-title`}>{isEditing ? `Edit ${entityLabel}` : `Add ${entityLabel}`}</h3>
                <span>{editingItem?.name || `New ${entityLabel.toLowerCase()}`}</span>
              </div>
              <button aria-label="Close" className="icon-button" disabled={saving} onClick={closeItemModal} type="button">x</button>
            </div>
            <div className="definition-modal-body">
              <div className="compact-form">
                {fields.map(([name, placeholder, required]) => (
                  name === "color"
                    ? <ColorInput initialValue={editingItem?.[name] || ""} key={name} label={placeholder} name={name} />
                    : <FormField key={name} label={placeholder}><input defaultValue={editingItem?.[name] || ""} name={name} placeholder={placeholder} required={required} /></FormField>
                ))}
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button" disabled={saving} onClick={closeItemModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" type="submit">
                {isEditing ? `Save ${entityLabel}` : `Create ${entityLabel}`}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function SubcategoryForm({ clearEditing, editingItem, notify, refs, reloadAll }) {
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setIsAdding(false);
    }
  }, [editingItem]);

  function openAddSubcategory() {
    clearEditing?.();
    setIsAdding(true);
  }

  function closeSubcategoryModal() {
    if (saving) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
  }

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
      setIsAdding(false);
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
    <>
      <div className="definition-panel-actions">
        <button className="primary-action" onClick={openAddSubcategory} type="button">Add Subcategory</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeSubcategoryModal()} role="presentation">
          <form aria-labelledby="subcategory-modal-title" aria-modal="true" className="definition-modal" key={editingItem?.id || "new-subcategory"} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id="subcategory-modal-title">{isEditing ? "Edit Subcategory" : "Add Subcategory"}</h3>
                <span>{editingItem?.name || "New subcategory"}</span>
              </div>
              <button aria-label="Close" className="icon-button" disabled={saving} onClick={closeSubcategoryModal} type="button">x</button>
            </div>
            <div className="definition-modal-body">
              <div className="compact-form">
                <FormField label="Category"><Select defaultValue={editingItem?.category?.id || ""} name="category_id" options={refs.categories.map((item) => [item.id, item.name])} required /></FormField>
                <FormField label="Name"><input defaultValue={editingItem?.name || ""} name="name" placeholder="Subcategory name" required /></FormField>
                <ColorInput initialValue={editingItem?.color || ""} label="Color" name="color" />
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button" disabled={saving} onClick={closeSubcategoryModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" type="submit">
                {isEditing ? "Save Subcategory" : "Create Subcategory"}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
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
  const [isAdding, setIsAdding] = useState(false);
  const isEditing = Boolean(editingItem);
  const isOpen = isAdding || isEditing;
  const [tagIds, setTagIds] = useState(() => (editingItem?.tags || []).map((item) => item.id));
  const [previewResult, setPreviewResult] = useState(null);
  const [previewText, setPreviewText] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingItem) {
      if (!isAdding) {
        setTagIds([]);
        setPreviewResult(null);
        setPreviewText("");
      }
      return;
    }
    setIsAdding(false);
    setTagIds((editingItem?.tags || []).map((item) => item.id));
    setPreviewResult(null);
    setPreviewText("");
  }, [editingItem, isAdding]);

  function openAddKeyword() {
    clearEditing?.();
    setTagIds([]);
    setPreviewResult(null);
    setPreviewText("");
    setIsAdding(true);
  }

  function closeKeywordModal() {
    if (saving || previewing) {
      return;
    }
    setIsAdding(false);
    clearEditing?.();
    setTagIds([]);
    setPreviewResult(null);
    setPreviewText("");
  }

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
      setIsAdding(false);
      clearEditing?.();
      setTagIds([]);
      setPreviewResult(null);
      setPreviewText("");
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
    <>
      <div className="definition-panel-actions">
        <button className="primary-action" onClick={openAddKeyword} type="button">Add Keyword</button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeKeywordModal()} role="presentation">
          <form aria-labelledby="keyword-modal-title" aria-modal="true" className="definition-modal keyword-modal" key={editingItem?.id || "new-keyword"} onSubmit={submit} role="dialog">
            <div className="definition-modal-header">
              <div>
                <h3 id="keyword-modal-title">{isEditing ? "Edit Keyword" : "Add Keyword"}</h3>
                <span>{editingItem?.name || "New keyword"}</span>
              </div>
              <button aria-label="Close" className="icon-button" disabled={saving || previewing} onClick={closeKeywordModal} type="button">x</button>
            </div>
            <div className="definition-modal-body">
              <div className="compact-form keyword-form">
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
              </div>
            </div>
            <div className="definition-modal-actions">
              <button className="link-button" disabled={saving || previewing} onClick={closeKeywordModal} type="button">Cancel</button>
              <LoadingButton busy={saving} busyLabel="Saving" className="primary-action" disabled={previewing} type="submit">
                {isEditing ? "Save Keyword" : "Create Keyword"}
              </LoadingButton>
            </div>
          </form>
        </div>
      ) : null}
    </>
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
