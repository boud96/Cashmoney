const API_BASE = "/api";
const UNASSIGNED_FILTER_VALUE = "__unassigned__";
const palette = ["#2f6f9f", "#2f8f65", "#c96e26", "#7655a6", "#b1842f", "#2f8a91", "#b34545", "#5f6f7a", "#4f9a6e", "#9d6b34"];

const state = {
    accounts: [],
    mappings: [],
    categories: [],
    subcategories: [],
    tags: [],
    keywords: [],
    transactions: [],
    transactionCount: 0,
    summary: null,
    recategorizeResult: null,
    recategorizeFilterKey: "",
    filterDefaults: {
        initialized: false,
        from: "",
        to: "",
    },
};

const pages = {
    dashboard: {
        title: "Dashboard",
        kicker: "Monthly flow, category mix, and transaction review.",
    },
    import: {
        title: "Import",
        kicker: "Load bank statement CSV files into the local transaction database.",
    },
    settings: {
        title: "Definitions",
        kicker: "Manage accounts, mappings, categories, tags, and keyword rules.",
    },
};

const mappingFields = [
    { key: "original_id", label: "Original ID", aliases: ["id", "transactionid", "operationid", "cislooperace", "idoperace"] },
    { key: "transaction_date", label: "Transaction Date", aliases: ["date", "datum", "transactiondate", "bookingdate", "ucetnidatum"] },
    { key: "posted_date", label: "Posted Date", aliases: ["posted", "posteddate", "valuedate", "datumzauctovani"] },
    { key: "description", label: "Description", aliases: ["description", "popis", "details", "merchant", "zprava"] },
    { key: "amount", label: "Amount", aliases: ["amount", "castka", "transactionamount", "sum"] },
    { key: "debit_amount", label: "Debit Amount", aliases: ["debit", "debitamount", "withdrawal", "odchozi"] },
    { key: "credit_amount", label: "Credit Amount", aliases: ["credit", "creditamount", "deposit", "prichozi"] },
    { key: "currency", label: "Currency", aliases: ["currency", "mena"] },
    { key: "counterparty_name", label: "Counterparty Name", aliases: ["counterparty", "counterpartyname", "partner", "nazevprotistrany"] },
    { key: "counterparty_account_number", label: "Counterparty Account", aliases: ["counterpartyaccount", "accountnumber", "protiucet", "ucetprotistrany"] },
    { key: "transaction_type", label: "Transaction Type", aliases: ["type", "transactiontype", "typ"] },
    { key: "variable_symbol", label: "Variable Symbol", aliases: ["variablesymbol", "vs", "variabilnisymbol"] },
    { key: "specific_symbol", label: "Specific Symbol", aliases: ["specificsymbol", "ss", "specifickysymbol"] },
    { key: "constant_symbol", label: "Constant Symbol", aliases: ["constantsymbol", "ks", "konstantnisymbol"] },
    { key: "counterparty_note", label: "Counterparty Note", aliases: ["counterpartynote", "messageforrecipient", "zpravaprijemci"] },
    { key: "my_note", label: "My Note", aliases: ["mynote", "note", "poznamka"] },
    { key: "other_note", label: "Other Note", aliases: ["othernote", "additionalnote", "detail"] },
];

const defaultCategorizationFields = [
    "description",
    "counterparty_name",
    "counterparty_note",
    "my_note",
    "other_note",
    "transaction_type",
];

document.addEventListener("DOMContentLoaded", () => {
    bindNavigation();
    bindForms();
    initializeMappingForm();
    loadAll();
});

function bindNavigation() {
    document.querySelectorAll("[data-page-target]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = button.dataset.pageTarget;
            document.querySelectorAll("[data-page-target]").forEach((item) => item.classList.toggle("is-active", item === button));
            document.querySelectorAll(".page").forEach((page) => page.classList.toggle("is-active", page.dataset.page === target));
            document.getElementById("page-title").textContent = pages[target].title;
            document.getElementById("page-kicker").textContent = pages[target].kicker;
        });
    });

    document.getElementById("refresh-button").addEventListener("click", () => loadAll());
    const debouncedDashboardLoad = debounce(loadDashboard, 200);
    document.getElementById("filters-form").addEventListener("input", debouncedDashboardLoad);
    document.getElementById("filters-form").addEventListener("change", debouncedDashboardLoad);
}

function bindForms() {
    document.getElementById("import-form").addEventListener("submit", submitImport);
    document.getElementById("account-form").addEventListener("submit", submitAccount);
    document.getElementById("mapping-form").addEventListener("submit", submitMapping);
    document.getElementById("category-form").addEventListener("submit", submitCategory);
    document.getElementById("subcategory-form").addEventListener("submit", submitSubcategory);
    document.getElementById("tag-form").addEventListener("submit", submitTag);
    document.getElementById("keyword-form").addEventListener("submit", submitKeyword);
    document.getElementById("recategorize-button").addEventListener("click", submitRecategorize);
    document.getElementById("relative-range-form").addEventListener("submit", applyRelativeRange);
    document.getElementById("mapping-detect-button").addEventListener("click", detectMappingColumns);
    document.getElementById("mapping-detect-file").addEventListener("change", detectMappingColumns);
    document.addEventListener("click", handleDeleteClick);
}

async function loadAll() {
    await checkHealth();
    await loadReferenceData();
    await loadFilterDefaults();
    renderSettings();
    await loadDashboard();
}

async function checkHealth() {
    try {
        await apiGet("/health/");
        document.getElementById("status-dot").className = "status-dot ok";
        document.getElementById("status-text").textContent = "Backend online";
    } catch (error) {
        document.getElementById("status-dot").className = "status-dot bad";
        document.getElementById("status-text").textContent = "Backend offline";
        showToast(error.message);
    }
}

async function loadReferenceData() {
    const [accounts, mappings, categories, subcategories, tags, keywords] = await Promise.all([
        apiGet("/bank-accounts/"),
        apiGet("/csv-mappings/"),
        apiGet("/categories/"),
        apiGet("/subcategories/"),
        apiGet("/tags/"),
        apiGet("/keywords/"),
    ]);

    Object.assign(state, { accounts, mappings, categories, subcategories, tags, keywords });
    fillReferenceSelects();
}

async function loadFilterDefaults() {
    const metadata = await apiGet("/transactions/filter-metadata/");
    const form = document.getElementById("filters-form");
    const fromInput = form.elements.date_from;
    const toInput = form.elements.date_to;
    const nextFrom = metadata.oldest_transaction_date || "";
    const nextTo = metadata.today || todayInputValue();
    const fromWasAuto = !state.filterDefaults.initialized || !fromInput.value || fromInput.value === state.filterDefaults.from;
    const toWasAuto = !state.filterDefaults.initialized || !toInput.value || toInput.value === state.filterDefaults.to;

    if (fromWasAuto) {
        fromInput.value = nextFrom;
    }
    if (toWasAuto) {
        toInput.value = nextTo;
    }

    state.filterDefaults = {
        initialized: true,
        from: nextFrom,
        to: nextTo,
    };
}

async function loadDashboard() {
    const params = filterParams();
    const currentFilterKey = paramsKey(params);
    const [summary, transactionPage] = await Promise.all([
        apiGet("/dashboard/summary/", params),
        apiGet("/transactions/", { ...params, limit: 500 }),
    ]);

    state.summary = summary;
    state.transactions = transactionPage.results || [];
    state.transactionCount = transactionPage.count || 0;
    if (state.recategorizeFilterKey && state.recategorizeFilterKey !== currentFilterKey) {
        state.recategorizeFilterKey = "";
        state.recategorizeResult = null;
    }

    renderMetrics(summary, state.transactionCount);
    renderRecategorizePanel(state.transactionCount);
    renderMonthlyChart(document.getElementById("monthly-chart"), summary.monthly);
    renderNestedDonut(document.getElementById("income-chart"), summary.income_categories, "income");
    renderNestedDonut(document.getElementById("expense-chart"), summary.expense_categories, "expense");
    renderFlatDonut(document.getElementById("wni-chart"), summary.want_need_investment);
    renderTransactions(state.transactions, state.transactionCount);
}

function filterParams() {
    const form = document.getElementById("filters-form");
    const data = new FormData(form);
    const params = {};
    for (const [key, value] of data.entries()) {
        if (key === "include_ignored") {
            continue;
        }
        if (value) {
            addParamValue(params, key, value);
        }
    }
    if (form.elements.include_ignored.checked) {
        params.include_ignored = "true";
    }
    return params;
}

function fillReferenceSelects() {
    fillSelect("filter-account", state.accounts, "All accounts");
    fillSelect("import-account", state.accounts);
    fillSelect("filter-category", state.categories, "All categories", (item) => item.name, [
        { value: UNASSIGNED_FILTER_VALUE, label: "Unassigned category" },
    ]);
    fillSelect("filter-subcategory", state.subcategories, "All subcategories", subLabel, [
        { value: UNASSIGNED_FILTER_VALUE, label: "Unassigned subcategory" },
    ]);
    fillSelect("filter-tag", state.tags, "All tags", (item) => item.name, [
        { value: UNASSIGNED_FILTER_VALUE, label: "No tags" },
    ]);
    fillSelect("import-mapping", state.mappings, "Account default");
    fillSelect("account-mapping", state.mappings, "No default mapping");
    fillSelect("subcategory-category", state.categories);
    fillSelect("keyword-subcategory", state.subcategories, "No subcategory", subLabel);
    fillSelect("keyword-tags", state.tags);
}

function fillSelect(id, items, blankLabel, labeler = (item) => item.name, extraOptions = []) {
    const select = document.getElementById(id);
    if (!select) {
        return;
    }
    const selected = Array.from(select.selectedOptions || []).map((option) => option.value);
    select.replaceChildren();
    if (blankLabel) {
        select.append(new Option(blankLabel, ""));
    }
    extraOptions.forEach((item) => select.append(new Option(item.label, item.value)));
    items.forEach((item) => select.append(new Option(labeler(item), item.id)));
    selected.forEach((value) => {
        const option = Array.from(select.options).find((candidate) => candidate.value === value);
        if (option) {
            option.selected = true;
        }
    });
}

function subLabel(item) {
    return `${item.category?.name || "No category"} / ${item.name}`;
}

function renderMetrics(summary, count) {
    const income = sum(summary.monthly, "income");
    const expense = sum(summary.monthly, "expense");
    const net = income - expense;
    const uncategorized = state.transactions.filter((transaction) => !transaction.category && !transaction.is_ignored).length;
    const metrics = [
        ["Income", money(income), "positive"],
        ["Expenses", money(expense), "negative"],
        ["Net", money(net), net >= 0 ? "positive" : "negative"],
        ["Transactions", count.toLocaleString(), ""],
        ["Uncategorized", uncategorized.toLocaleString(), ""],
    ];

    document.getElementById("metrics-grid").innerHTML = metrics.map(([label, value, tone]) => `
        <div class="metric">
            <div class="metric-label">${escapeHtml(label)}</div>
            <div class="metric-value ${tone}">${escapeHtml(value)}</div>
        </div>
    `).join("");
}

function renderRecategorizePanel(count) {
    const button = document.getElementById("recategorize-button");
    const label = `${count.toLocaleString()} filtered ${pluralize("transaction", count)}`;
    document.getElementById("recategorize-count").textContent = label;
    document.getElementById("recategorize-scope-count").textContent = label;
    button.disabled = count === 0;
    renderRecategorizeResult(state.recategorizeResult);
}

function renderRecategorizeResult(result) {
    const container = document.getElementById("recategorize-result");
    if (!result) {
        container.innerHTML = "";
        return;
    }

    const stats = [
        ["Processed", result.processed],
        ["Updated", result.updated],
        ["Unchanged", result.unchanged],
        ["Uncategorized", result.uncategorized],
        ["Conflicts", result.conflicts],
        ["Skipped", result.skipped_no_mapping],
    ];
    container.innerHTML = `
        <div class="recategorize-stats">
            ${stats.map(([label, value]) => `
                <div class="recategorize-stat">
                    <span>${escapeHtml(label)}</span>
                    <strong>${Number(value || 0).toLocaleString()}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function renderMonthlyChart(container, rows) {
    if (!rows.length) {
        renderEmpty(container);
        return;
    }
    const width = 720;
    const height = 250;
    const pad = { top: 18, right: 18, bottom: 34, left: 54 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const maxValue = Math.max(...rows.flatMap((row) => [row.income, row.expense]), 1);
    const groupWidth = innerWidth / rows.length;
    const barWidth = Math.max(18, groupWidth * 0.26);

    const bars = rows.map((row, index) => {
        const x = pad.left + index * groupWidth + groupWidth / 2;
        const incomeHeight = (row.income / maxValue) * innerHeight;
        const expenseHeight = (row.expense / maxValue) * innerHeight;
        return `
            <rect x="${x - barWidth - 3}" y="${pad.top + innerHeight - incomeHeight}" width="${barWidth}" height="${incomeHeight}" rx="4" fill="${palette[1]}"></rect>
            <rect x="${x + 3}" y="${pad.top + innerHeight - expenseHeight}" width="${barWidth}" height="${expenseHeight}" rx="4" fill="${palette[2]}"></rect>
            <text x="${x}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#667481">${escapeHtml(row.month)}</text>
        `;
    }).join("");

    container.innerHTML = `
        <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly income and expense chart">
            <line x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + innerHeight}" y2="${pad.top + innerHeight}" stroke="#d8e0e5"></line>
            <line x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + innerHeight}" stroke="#d8e0e5"></line>
            <text x="10" y="${pad.top + 8}" font-size="12" fill="#667481">${money(maxValue)}</text>
            ${bars}
        </svg>
        <div class="legend">
            ${legendItem(palette[1], "Income")}
            ${legendItem(palette[2], "Expenses")}
        </div>
    `;
}

function renderNestedDonut(container, rows, label) {
    if (!rows.length) {
        renderEmpty(container);
        return;
    }
    const total = rows.reduce((acc, row) => acc + row.amount, 0);
    let start = -90;
    const innerPaths = [];
    const outerPaths = [];
    const legend = [];

    rows.forEach((row, index) => {
        const color = palette[index % palette.length];
        const end = start + (row.amount / total) * 360;
        innerPaths.push(`<path d="${donutSlice(120, 120, 45, 74, start, end)}" fill="${color}"><title>${escapeHtml(row.name)} ${money(row.amount)}</title></path>`);
        legend.push(legendItem(color, `${row.name} ${money(row.amount)}`));

        let childStart = start;
        (row.children || []).forEach((child, childIndex) => {
            const childEnd = childStart + (child.amount / total) * 360;
            const childColor = shadeColor(color, 16 + childIndex * 9);
            outerPaths.push(`<path d="${donutSlice(120, 120, 80, 108, childStart, childEnd)}" fill="${childColor}"><title>${escapeHtml(child.name)} ${money(child.amount)}</title></path>`);
            childStart = childEnd;
        });
        start = end;
    });

    container.innerHTML = `
        <svg class="chart-svg" viewBox="0 0 240 240" role="img" aria-label="${label} category chart">
            ${outerPaths.join("")}
            ${innerPaths.join("")}
            <circle cx="120" cy="120" r="36" fill="#fff"></circle>
            <text x="120" y="117" text-anchor="middle" font-size="13" font-weight="760" fill="#17212b">${money(total)}</text>
            <text x="120" y="134" text-anchor="middle" font-size="10" fill="#667481">${escapeHtml(label)}</text>
        </svg>
        <div class="legend">${legend.join("")}</div>
    `;
}

function renderFlatDonut(container, rows) {
    const cleanRows = rows.filter((row) => row.amount > 0);
    if (!cleanRows.length) {
        renderEmpty(container);
        return;
    }
    const total = cleanRows.reduce((acc, row) => acc + row.amount, 0);
    let start = -90;
    const paths = [];
    const legend = [];
    cleanRows.forEach((row, index) => {
        const color = palette[index % palette.length];
        const end = start + (row.amount / total) * 360;
        paths.push(`<path d="${donutSlice(120, 120, 58, 102, start, end)}" fill="${color}"><title>${escapeHtml(titleCase(row.name))} ${money(row.amount)}</title></path>`);
        legend.push(legendItem(color, `${titleCase(row.name)} ${money(row.amount)}`));
        start = end;
    });
    container.innerHTML = `
        <svg class="chart-svg" viewBox="0 0 240 240" role="img" aria-label="Want need investment chart">
            ${paths.join("")}
            <circle cx="120" cy="120" r="47" fill="#fff"></circle>
            <text x="120" y="117" text-anchor="middle" font-size="13" font-weight="760" fill="#17212b">${money(total)}</text>
            <text x="120" y="134" text-anchor="middle" font-size="10" fill="#667481">expenses</text>
        </svg>
        <div class="legend">${legend.join("")}</div>
    `;
}

function renderTransactions(transactions, totalCount) {
    document.getElementById("transaction-count").textContent = `${totalCount.toLocaleString()} shown`;
    const body = document.getElementById("transactions-body");
    if (!transactions.length) {
        body.innerHTML = `<tr><td colspan="8" class="muted">No transactions match the current filters.</td></tr>`;
        return;
    }
    body.innerHTML = transactions.map((transaction) => {
        const amountClass = transaction.amount >= 0 ? "amount-income" : "amount-expense";
        const tags = (transaction.tags || []).map((tag) => `<span class="pill">${escapeHtml(tag.name)}</span>`).join(" ");
        return `
            <tr>
                <td>${escapeHtml(transaction.transaction_date || "")}</td>
                <td class="description-cell">${escapeHtml(transaction.description || "")}</td>
                <td class="right ${amountClass}">${money(transaction.amount)}</td>
                <td>${escapeHtml(transaction.bank_account?.name || "")}</td>
                <td>${escapeHtml(transaction.category?.name || "Uncategorized")}</td>
                <td>${escapeHtml(transaction.subcategory?.name || "Other")}</td>
                <td>${transaction.want_need_investment ? `<span class="pill">${escapeHtml(titleCase(transaction.want_need_investment))}</span>` : ""}</td>
                <td><div class="tag-cloud">${tags}</div></td>
            </tr>
        `;
    }).join("");
}

function renderSettings() {
    renderList("accounts-list", state.accounts, (account) => [account.name, `${account.bank_name || "Bank"} - ${account.account_number}`], "/bank-accounts/");
    renderList("mappings-list", state.mappings, (mapping) => [mapping.name, `${mapping.delimiter} - ${mapping.date_format}`], "/csv-mappings/");
    renderList("categories-list", state.categories, (category) => [category.name, category.description || ""], "/categories/");
    renderList("subcategories-list", state.subcategories, (subcategory) => [subcategory.name, subcategory.category?.name || ""], "/subcategories/");
    renderList("tags-list", state.tags, (tag) => [tag.name, tag.description || ""], "/tags/");
    renderList("keywords-list", state.keywords, (keyword) => [
        keyword.name,
        `${keyword.include_terms.join(", ")} - ${keyword.subcategory?.name || "No subcategory"} - ${keyword.want_need_investment || "No WNI"}`,
    ], "/keywords/");
}

function renderList(id, items, formatter, endpointBase) {
    const list = document.getElementById(id);
    list.innerHTML = items.map((item) => {
        const [title, subtitle] = formatter(item);
        return `
            <div class="item-row">
                <div>
                    <div class="item-title">${escapeHtml(title)}</div>
                    <div class="item-subtitle">${escapeHtml(subtitle || "")}</div>
                </div>
                <div class="item-actions">
                    ${item.color ? `<span class="swatch" style="background:${escapeHtml(item.color)}"></span>` : ""}
                    <button
                        class="delete-button"
                        type="button"
                        data-delete-path="${escapeHtml(`${endpointBase}${item.id}/`)}"
                        data-delete-name="${escapeHtml(title)}"
                    >Delete</button>
                </div>
            </div>
        `;
    }).join("") || `<div class="muted">No records yet.</div>`;
}

async function handleDeleteClick(event) {
    const button = event.target.closest("[data-delete-path]");
    if (!button) {
        return;
    }

    const name = button.dataset.deleteName || "this item";
    const confirmed = window.confirm(`Delete ${name}?`);
    if (!confirmed) {
        return;
    }

    button.disabled = true;
    try {
        await apiDelete(button.dataset.deletePath);
        showToast(`${name} deleted`);
        await loadAll();
    } catch (error) {
        button.disabled = false;
        showToast(error.message);
    }
}

async function submitRecategorize() {
    const count = state.transactionCount || 0;
    if (!count) {
        showToast("No filtered transactions");
        return;
    }

    const confirmed = window.confirm(`Recategorize ${count.toLocaleString()} filtered ${pluralize("transaction", count)}?`);
    if (!confirmed) {
        return;
    }

    const button = document.getElementById("recategorize-button");
    const params = filterParams();
    button.disabled = true;
    try {
        const result = await apiPost("/transactions/recategorize/", {}, params);
        state.recategorizeResult = result;
        state.recategorizeFilterKey = paramsKey(params);
        renderRecategorizeResult(result);
        showToast(`${Number(result.updated || 0).toLocaleString()} ${pluralize("transaction", result.updated)} updated`);
        await loadDashboard();
    } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = state.transactionCount === 0;
    }
}

async function applyRelativeRange(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = Math.max(1, Number(form.elements.relative_count.value || 1));
    const unit = form.elements.relative_unit.value;
    const today = parseDateInput(state.filterDefaults.to || todayInputValue()) || new Date();
    const fromDate = subtractRelativeDate(today, amount, unit);
    const filtersForm = document.getElementById("filters-form");

    filtersForm.elements.date_from.value = formatDateInput(fromDate);
    filtersForm.elements.date_to.value = formatDateInput(today);
    await loadDashboard();
}

async function submitImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const response = await fetch(`${API_BASE}/imports/`, { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) {
        showToast(payload.error || "Import failed");
        return;
    }
    document.getElementById("import-report").innerHTML = `
        <h2>Import Report</h2>
        <div class="metrics-grid">
            <div class="metric"><div class="metric-label">Loaded</div><div class="metric-value">${payload.report.loaded}</div></div>
            <div class="metric"><div class="metric-label">Created</div><div class="metric-value positive">${payload.report.created.count}</div></div>
            <div class="metric"><div class="metric-label">Duplicates</div><div class="metric-value">${payload.report.skipped.duplicates.length}</div></div>
            <div class="metric"><div class="metric-label">Errors</div><div class="metric-value negative">${payload.report.skipped.errors.length}</div></div>
        </div>
    `;
    form.reset();
    showToast("CSV imported");
    await loadAll();
}

async function submitAccount(event) {
    event.preventDefault();
    const data = formObject(event.currentTarget);
    data.owners = Number(data.owners || 1);
    await apiPost("/bank-accounts/", data);
    event.currentTarget.reset();
    await loadAll();
    showToast("Bank account added");
}

async function submitMapping(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    data.column_map = selectedColumnMap();
    const validationError = validateColumnMap(data.column_map);
    if (validationError) {
        showToast(validationError);
        return;
    }
    data.categorization_fields = selectedCategorizationFields();
    data.header_row = Number(data.header_row || 0);
    await apiPost("/csv-mappings/", data);
    form.reset();
    initializeMappingForm();
    await loadAll();
    showToast("CSV mapping added");
}

async function submitCategory(event) {
    event.preventDefault();
    await apiPost("/categories/", formObject(event.currentTarget));
    event.currentTarget.reset();
    await loadAll();
    showToast("Category added");
}

async function submitSubcategory(event) {
    event.preventDefault();
    await apiPost("/subcategories/", formObject(event.currentTarget));
    event.currentTarget.reset();
    await loadAll();
    showToast("Subcategory added");
}

async function submitTag(event) {
    event.preventDefault();
    await apiPost("/tags/", formObject(event.currentTarget));
    event.currentTarget.reset();
    await loadAll();
    showToast("Tag added");
}

async function submitKeyword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    data.include_terms = lines(data.include_terms);
    data.exclude_terms = lines(data.exclude_terms);
    data.priority = Number(data.priority || 0);
    data.is_ignored = Boolean(form.elements.is_ignored.checked);
    data.tag_ids = Array.from(form.elements.tag_ids.selectedOptions).map((option) => option.value);
    await apiPost("/keywords/", data);
    form.reset();
    await loadAll();
    showToast("Keyword added");
}

function formObject(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
        data[key] = value;
    });
    return data;
}

function initializeMappingForm() {
    renderMappingColumnControls([]);
    renderCategorizationFieldOptions(defaultCategorizationFields);
    renderMappingSample(null);
    document.getElementById("mapping-detect-status").textContent = "";
}

function renderCategorizationFieldOptions(selectedFields = []) {
    const select = document.getElementById("mapping-categorization-fields");
    const selected = new Set(selectedFields);
    select.replaceChildren();
    mappingFields
        .filter((field) => !["original_id", "transaction_date", "posted_date", "amount", "debit_amount", "credit_amount", "currency"].includes(field.key))
        .forEach((field) => {
            const option = new Option(field.label, field.key);
            option.selected = selected.has(field.key);
            select.append(option);
        });
}

async function detectMappingColumns() {
    const form = document.getElementById("mapping-form");
    const fileInput = document.getElementById("mapping-detect-file");
    const button = document.getElementById("mapping-detect-button");
    const status = document.getElementById("mapping-detect-status");
    const file = fileInput.files[0];
    if (!file) {
        showToast("Choose a sample CSV");
        return;
    }

    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("sample_size", "5");
    [
        "delimiter",
        "quotechar",
        "encoding",
        "header_row",
        "date_format",
        "decimal_separator",
        "thousands_separator",
        "default_currency",
    ].forEach((fieldName) => {
        formData.append(fieldName, form.elements[fieldName]?.value || "");
    });

    button.disabled = true;
    status.textContent = "Detecting";
    try {
        const response = await fetch(`${API_BASE}/csv-mappings/detect-columns/`, {
            method: "POST",
            body: formData,
        });
        const payload = await readJson(response);
        const headers = payload.headers || [];
        renderMappingColumnControls(headers, guessColumnMap(headers));
        renderMappingSample(payload);
        status.textContent = `${headers.length.toLocaleString()} columns detected`;
        showToast("Columns detected");
    } catch (error) {
        status.textContent = "Detection failed";
        showToast(error.message);
    } finally {
        button.disabled = false;
    }
}

function renderMappingColumnControls(headers, selected = {}) {
    const container = document.getElementById("mapping-column-map");
    const disabled = headers.length === 0 ? "disabled" : "";
    const options = [
        `<option value="">No column</option>`,
        ...headers.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`),
    ].join("");

    container.innerHTML = mappingFields.map((field) => {
        const value = selected[field.key] || "";
        return `
            <label class="mapping-column-field">
                <span>${escapeHtml(field.label)}</span>
                <select data-column-map-field="${escapeHtml(field.key)}" ${disabled}>
                    ${options}
                </select>
            </label>
        `;
    }).join("");

    container.querySelectorAll("[data-column-map-field]").forEach((select) => {
        select.value = selected[select.dataset.columnMapField] || "";
    });
}

function renderMappingSample(payload) {
    const container = document.getElementById("mapping-sample");
    if (!payload || !payload.headers?.length) {
        container.innerHTML = "";
        return;
    }

    const rows = payload.sample_rows || [];
    container.innerHTML = `
        <div class="mapping-sample-meta">${Number(payload.loaded || 0).toLocaleString()} rows loaded</div>
        <div class="mapping-sample-table">
            <table>
                <thead>
                    <tr>${payload.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            ${payload.headers.map((header) => `<td>${escapeHtml(row.raw?.[header] || "")}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function selectedColumnMap() {
    const columnMap = {};
    document.querySelectorAll("[data-column-map-field]").forEach((select) => {
        if (select.value) {
            columnMap[select.dataset.columnMapField] = select.value;
        }
    });
    return columnMap;
}

function selectedCategorizationFields() {
    const select = document.getElementById("mapping-categorization-fields");
    return Array.from(select.selectedOptions).map((option) => option.value);
}

function validateColumnMap(columnMap) {
    if (!columnMap.transaction_date) {
        return "Transaction date column is required";
    }
    if (!columnMap.amount && !columnMap.debit_amount && !columnMap.credit_amount) {
        return "Amount or debit/credit column is required";
    }
    return "";
}

function guessColumnMap(headers) {
    const normalizedHeaders = headers.map((header) => ({
        header,
        normalized: normalizeMappingName(header),
    }));
    const selected = {};
    const used = new Set();

    mappingFields.forEach((field) => {
        const aliases = [field.key, field.label, ...(field.aliases || [])].map(normalizeMappingName);
        const exact = normalizedHeaders.find((item) => (
            !used.has(item.header) && aliases.includes(item.normalized)
        ));
        const partial = exact || normalizedHeaders.find((item) => (
            !used.has(item.header)
            && aliases.some((alias) => item.normalized.includes(alias) || alias.includes(item.normalized))
        ));
        if (partial) {
            selected[field.key] = partial.header;
            used.add(partial.header);
        }
    });

    return selected;
}

async function apiGet(path, params = {}) {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    appendSearchParams(url, params);
    const response = await fetch(url);
    return readJson(response);
}

async function apiPost(path, data, params = {}) {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    appendSearchParams(url, params);
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    return readJson(response);
}

async function apiDelete(path) {
    const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
    return readJson(response);
}

async function readJson(response) {
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
    }
    return payload;
}

function donutSlice(cx, cy, r0, r1, startAngle, endAngle) {
    const startOuter = polar(cx, cy, r1, endAngle);
    const endOuter = polar(cx, cy, r1, startAngle);
    const startInner = polar(cx, cy, r0, startAngle);
    const endInner = polar(cx, cy, r0, endAngle);
    const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
    return [
        `M ${startOuter.x} ${startOuter.y}`,
        `A ${r1} ${r1} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
        `L ${startInner.x} ${startInner.y}`,
        `A ${r0} ${r0} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
        "Z",
    ].join(" ");
}

function polar(cx, cy, radius, angle) {
    const radians = (angle - 90) * Math.PI / 180;
    return {
        x: cx + radius * Math.cos(radians),
        y: cy + radius * Math.sin(radians),
    };
}

function shadeColor(hex, percent) {
    const clean = hex.replace("#", "");
    const number = parseInt(clean, 16);
    const amount = Math.round(2.55 * percent);
    const red = Math.min(255, (number >> 16) + amount);
    const green = Math.min(255, ((number >> 8) & 0x00ff) + amount);
    const blue = Math.min(255, (number & 0x0000ff) + amount);
    return `#${(0x1000000 + red * 0x10000 + green * 0x100 + blue).toString(16).slice(1)}`;
}

function renderEmpty(container) {
    container.innerHTML = `<div class="chart-empty">No data</div>`;
}

function legendItem(color, label) {
    return `<span class="legend-item"><span class="swatch" style="background:${color}"></span>${escapeHtml(label)}</span>`;
}

function money(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "CZK",
        maximumFractionDigits: 0,
    }).format(number);
}

function sum(rows, key) {
    return rows.reduce((acc, row) => acc + Number(row[key] || 0), 0);
}

function lines(value) {
    return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function addParamValue(params, key, value) {
    if (params[key] === undefined) {
        params[key] = value;
        return;
    }
    if (!Array.isArray(params[key])) {
        params[key] = [params[key]];
    }
    params[key].push(value);
}

function appendSearchParams(url, params) {
    Object.entries(params).forEach(([key, value]) => {
        const values = Array.isArray(value) ? value : [value];
        values.forEach((item) => {
            if (item !== undefined && item !== null && item !== "") {
                url.searchParams.append(key, item);
            }
        });
    });
}

function todayInputValue() {
    return formatDateInput(new Date());
}

function parseDateInput(value) {
    if (!value) {
        return null;
    }
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        return null;
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function subtractRelativeDate(date, amount, unit) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (unit === "weeks") {
        next.setDate(next.getDate() - amount * 7);
        return next;
    }
    if (unit === "months") {
        return subtractMonths(next, amount);
    }
    next.setDate(next.getDate() - amount);
    return next;
}

function subtractMonths(date, amount) {
    const target = new Date(date.getFullYear(), date.getMonth() - amount, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
}

function titleCase(value) {
    return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeMappingName(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function pluralize(word, count) {
    return Number(count || 0) === 1 ? word : `${word}s`;
}

function paramsKey(params) {
    return JSON.stringify(
        Object.entries(params)
            .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value])
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }[character]));
}

function debounce(callback, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => callback(...args), delay);
    };
}

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}
