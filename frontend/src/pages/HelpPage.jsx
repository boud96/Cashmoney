const workflowSteps = [
  "Define categories, subcategories, tags, and CSV mappings.",
  "Assign a default CSV mapping to each bank account.",
  "Preview and import CSV statements.",
  "Review filters, stats, charts, and transactions on the Dashboard.",
  "Improve keyword rules, then recategorize the filtered transactions.",
];

const conceptItems = [
  ["Bank Account", "Groups imported transactions and decides which CSV mapping is used during import."],
  ["CSV Mapping", "Describes how a bank export is parsed: dates, separators, columns, currency, and categorization fields."],
  ["Default Currency", "The reporting currency used by dashboard totals, charts, and converted transaction amounts."],
  ["Category", "The top-level reporting bucket. It is derived from the assigned subcategory."],
  ["Subcategory", "The main assignable classification value for a transaction."],
  ["WNI", "Want, Need, or Investment. Useful for expense analysis beyond category."],
  ["Tags", "Flexible labels for filtering and grouping transactions across categories."],
  ["Ignored", "Marks transactions that should be excluded from normal dashboard analysis unless explicitly included."],
  ["Locked", "Protects manual categorization edits from normal recategorization."],
];

const troubleshootingItems = [
  ["Import button is disabled", "Choose a CSV file, select a bank account, make sure that account has a default CSV mapping, then run Preview Import first."],
  ["CSV preview has errors", "Check the CSV mapping delimiter, header row, encoding, date format, decimal separator, and required mapped columns."],
  ["No transactions are shown", "A checklist filter with no selected items means show nothing. Use Select all or load a saved filter."],
  ["A row did not recategorize", "It may be locked. Enable Include locked before recategorizing if you intentionally want to reset locked rows."],
  ["Internal transfers are not detected", "Use Find Transfers from Dashboard Actions, increase the date offset if bank posting dates differ, and check that both account statements have been imported."],
  ["Charts look wrong", "Review date range, ignored/locked inclusion, direction, account, category, subcategory, WNI, tag, and saved filter state."],
];

const appVersion = __CASHMONEY_APP_VERSION__ === "unknown" ? "Unknown" : `v${__CASHMONEY_APP_VERSION__}`;

export default function HelpPage() {
  return (
    <div className="help-page">
      <section className="panel help-hero">
        <div>
          <h2>Cashmoney Help Guide</h2>
          <p>
            Cashmoney is a local finance app for importing bank CSV files, categorizing transactions,
            reviewing spending, and maintaining your own rules. Most work starts in Definitions,
            continues through Import, and gets reviewed or corrected on the Dashboard.
          </p>
        </div>
        <div className="help-workflow">
          <h3>Normal workflow</h3>
          <ol>
            {workflowSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </section>

      <section className="help-grid">
        <HelpCard title="Core Concepts" wide>
          <div className="help-concept-grid">
            {conceptItems.map(([term, description]) => (
              <div className="help-concept" key={term}>
                <strong>{term}</strong>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </HelpCard>

        <HelpCard title="Definitions">
          <p>
            Definitions are the reusable objects used by imports, filters, charts, and automatic
            categorization.
          </p>
          <ul>
            <li><strong>App Settings:</strong> set the dashboard default currency, review FX cache status, and configure automatic internal-transfer handling.</li>
            <li><strong>CSV Mappings:</strong> map CSV columns to transaction fields and choose categorization fields used by Keywords.</li>
            <li><strong>Bank Accounts:</strong> store account details and set the default CSV mapping used by Import.</li>
            <li><strong>Categories and Subcategories:</strong> define the reporting hierarchy shown in filters, charts, and the table.</li>
            <li><strong>Tags:</strong> add cross-cutting labels such as projects, people, trips, or special cases.</li>
            <li><strong>Keywords:</strong> match transaction text and assign subcategory, WNI, tags, or ignored status.</li>
          </ul>
        </HelpCard>

        <HelpCard title="CSV Mappings">
          <p>
            A CSV Mapping should represent one bank-export format. Use Detect Columns with a sample
            CSV whenever possible, then inspect the parsed sample rows before saving.
          </p>
          <ul>
            <li><strong>Required fields:</strong> transaction date and amount must be mapped.</li>
            <li><strong>Description:</strong> can combine multiple CSV columns into the dashboard description.</li>
            <li><strong>Categorization Fields:</strong> decide which parsed transaction fields Keywords inspect during import and recategorization.</li>
            <li><strong>Advanced parsing:</strong> delimiter, quote character, encoding, header row, date format, and separators stay editable.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Import">
          <p>
            The Import page is preview-first. The selected bank account automatically supplies the
            CSV mapping; there is no separate mapping picker in the import flow.
          </p>
          <ol>
            <li>Drop or browse for a CSV file.</li>
            <li>Select the bank account.</li>
            <li>Confirm the shown default CSV mapping. If there is a warning, set the default mapping in Definitions first.</li>
            <li>Run Preview Import. The preview shows parsed date, amount, description, status, headers, and summary counts.</li>
            <li>Import Valid Rows after the preview looks right.</li>
          </ol>
          <p>
            Recent Imports shows the latest import batches. Import Report shows loaded, created,
            duplicate, and error counts for the last import in the session.
          </p>
          <p>
            Exchange rates sync automatically after imported transactions are saved. If the provider
            is unavailable, App Settings shows a retry action.
          </p>
        </HelpCard>

        <HelpCard title="Dashboard Filters">
          <p>
            Filters control the table, stats, charts, recategorization, and bulk assignment. Actions
            apply only to the current filtered transaction set.
          </p>
          <ul>
            <li><strong>Date range:</strong> From and To use the same YYYY-MM-DD format as the table. The relative range controls can quickly set a recent period.</li>
            <li><strong>Saved filters:</strong> save the current filter state under a name and load it later.</li>
            <li><strong>Checklist filters:</strong> empty means show nothing. On startup, all checklist options are selected.</li>
            <li><strong>Category/Subcategory/WNI:</strong> subcategory options narrow automatically when categories are selected.</li>
            <li><strong>Direction:</strong> Incomes are positive transactions and Expenses are negative transactions.</li>
            <li><strong>Ignored / Locked:</strong> control whether those rows appear in the filtered data.</li>
            <li><strong>Divide by account owner count:</strong> divides shared-account amounts by the account owner count.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Stats, Charts, And Amount Privacy">
          <p>
            The Dashboard combines summary metrics, charts, and a transaction grid for the active
            filters.
          </p>
          <ul>
            <li><strong>Stats:</strong> Incomes, Expenses, Net, Transactions, and Uncategorized reflect the current filters in the app default currency.</li>
            <li><strong>Charts:</strong> Monthly Flow, Income Categories, Expense Categories, Want / Need / Investment, and Top Expense Subcategories.</li>
            <li><strong>Exchange rates:</strong> original imported amounts stay unchanged; converted totals use cached rates that sync after imports and default currency changes.</li>
            <li><strong>Hide amounts:</strong> the eye button hides amount values in the dashboard and import preview.</li>
            <li><strong>Accent and theme:</strong> use the sidebar footer controls for accent color and light/dark mode.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Editing Transactions">
          <p>
            The transaction grid is editable where a small pencil appears in the header. Changes are
            saved immediately and the edited row updates in place.
          </p>
          <ul>
            <li><strong>Subcategory:</strong> edits the subcategory and therefore the derived category.</li>
            <li><strong>WNI:</strong> edits Want, Need, Investment, or blank.</li>
            <li><strong>Tags:</strong> opens the tag editor for multi-tag changes.</li>
            <li><strong>Ignored:</strong> toggles whether the transaction is excluded from normal analysis.</li>
            <li><strong>Locked:</strong> manually protect or unlock categorization.</li>
          </ul>
          <p>
            Manual changes to subcategory, WNI, tags, ignored, or category-related fields lock the
            transaction so future recategorization does not overwrite your correction by default.
            If a saved value no longer matches the current filters, the row can remain visible
            temporarily with an accent marker until filters refresh or change.
          </p>
        </HelpCard>

        <HelpCard title="Actions">
          <p>
            The Actions section changes transactions in the current filter scope. Review the shown
            transaction count before confirming any action.
          </p>
          <ul>
            <li><strong>Recategorize:</strong> reruns keyword matching for the filtered transactions.</li>
            <li><strong>Include locked:</strong> resets locked filtered transactions and lets recategorization overwrite them.</li>
            <li><strong>Bulk assign:</strong> updates subcategory, tags, WNI, ignored, or locked fields for all filtered transactions.</li>
            <li><strong>Find Transfers:</strong> previews likely transfers between defined accounts by matching opposite same-currency amounts across nearby dates.</li>
            <li><strong>Review uncategorized:</strong> reviews uncategorized transaction groups and creates keyword rules from suggested terms.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Conflicts And Uncategorized">
          <p>
            Recategorization reports details so you can improve rules instead of guessing.
          </p>
          <ul>
            <li><strong>Conflicts:</strong> more than one matching rule points to incompatible categorization. Inspect the matching keywords and adjust priority, include terms, or exclude terms.</li>
            <li><strong>Uncategorized:</strong> no rule assigned a subcategory. Add or improve Keywords, then recategorize the filtered transactions.</li>
            <li><strong>Updated / unchanged:</strong> result sections show readable transaction labels so IDs are not the only clue.</li>
            <li><strong>Ignored internal transfers:</strong> confirmed transfer pairs are ignored, locked, and assigned the configured transfer subcategory when one is set.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Maintenance">
          <p>
            Maintenance is for database-level work and dangerous cleanup actions. It is not part of
            normal transaction review.
          </p>
          <ul>
            <li><strong>Database Snapshot:</strong> shows current counts for finance objects and sample data.</li>
            <li><strong>Export database backup:</strong> downloads a SQLite backup of the current local database.</li>
            <li><strong>Restore database backup:</strong> replaces the current database and saves a pre-restore backup automatically.</li>
            <li><strong>Recreate sample data:</strong> resets only the demo sample dataset.</li>
            <li><strong>Admin:</strong> opens Django admin for power users.</li>
            <li><strong>Danger Zone:</strong> delete sample data, all transactions, or all finance data. Export a backup first.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Troubleshooting" wide>
          <div className="help-troubleshooting-grid">
            {troubleshootingItems.map(([problem, fix]) => (
              <div className="help-troubleshooting-item" key={problem}>
                <strong>{problem}</strong>
                <span>{fix}</span>
              </div>
            ))}
          </div>
        </HelpCard>

        <HelpCard title="About" wide>
          <dl className="help-version-list">
            <div>
              <dt>App version</dt>
              <dd>{appVersion}</dd>
            </div>
          </dl>
        </HelpCard>
      </section>
    </div>
  );
}

function HelpCard({ children, title, wide = false }) {
  return (
    <article className={`panel help-card ${wide ? "help-card-wide" : ""}`}>
      <h2>{title}</h2>
      {children}
    </article>
  );
}
