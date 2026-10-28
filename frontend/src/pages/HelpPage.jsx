const workflowSteps = [
  "Define categories, subcategories, tags, and import mappings.",
  "Assign a default import mapping to each bank account.",
  "Preview and import bank statements (CSV or camt.053 XML).",
  "Review the totals, charts, and transactions on the Dashboard.",
  "Improve keyword rules, then recategorize the filtered transactions.",
];

const conceptItems = [
  ["Bank account", "Groups imported transactions and decides which import mapping is used during import."],
  ["Import mapping", "Describes how a bank file (CSV or camt.053 XML) is read: dates, separators, columns, currency, and categorization fields."],
  ["Default currency", "The reporting currency used by dashboard totals, charts, and converted transaction amounts."],
  ["Category", "The top-level reporting bucket. It is derived from the assigned subcategory."],
  ["Subcategory", "The main assignable classification value for a transaction."],
  ["WNI", "Want, Need, or Investment. Useful for expense analysis beyond category."],
  ["Tags", "Flexible labels for filtering and grouping transactions across categories."],
  ["Ignored", "Marks transactions that should be excluded from normal dashboard analysis unless explicitly included."],
  ["Locked", "Protects manual categorization edits from normal recategorization."],
];

const troubleshootingItems = [
  ["Import button is disabled", "Choose a bank account that has a default import mapping, choose a CSV or XML statement, then run Preview first."],
  ["The preview has errors", "Check the import mapping's delimiter, header row, encoding, date format, decimal separator, and required mapped columns. An amount that doesn't fit the decimal separator (12.50 when the mapping expects 12,50) is an error rather than a wrong amount."],
  ["No transactions are shown", "A checklist filter with no selected items means show nothing (except Tag, where it means any tag). Use Select all or load a saved filter."],
  ["A row did not recategorize", "It may be locked. Enable Include locked before recategorizing if you intentionally want to reset locked rows."],
  ["Internal transfers are not detected", "Use Find transfers above the table on the Dashboard's Transactions tab, increase the date offset if bank posting dates differ, and check that both account statements have been imported."],
  ["Charts look wrong", "Review date range, ignored/locked inclusion, direction, account, category, subcategory, WNI, tag, and saved filter state."],
  ["\"Can't reach the Cashmoney backend\"", "The local backend stopped answering. In the desktop app, restart Cashmoney; when running from the scripts, restart run_app.bat (run_app.sh on Linux). Then use Retry on the banner."],
];

const appVersion = __CASHMONEY_APP_VERSION__ === "unknown" ? "Unknown" : `v${__CASHMONEY_APP_VERSION__}`;
const rawDonationUrl = String(import.meta.env.VITE_CASHMONEY_DONATION_URL || "").trim();
const donationUrl = /^https:\/\//i.test(rawDonationUrl) ? rawDonationUrl : "";

export default function HelpPage() {
  return (
    <div className="help-page">
      <section className="panel help-hero">
        <div>
          <h2>Cashmoney help guide</h2>
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
        <HelpCard title="Core concepts" wide>
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
            categorization. Each kind has its own tab, in the order you set them up, with its count;
            the page opens on the tab you used last.
          </p>
          <ul>
            <li><strong>Accounts:</strong> store account details and set the default import mapping used by Import.</li>
            <li><strong>Import mappings:</strong> map file columns to transaction fields and choose categorization fields used by Keywords.</li>
            <li><strong>Categories and Subcategories:</strong> define the reporting hierarchy shown in filters, charts, and the table.</li>
            <li><strong>Tags:</strong> add cross-cutting labels such as projects, people, trips, or special cases.</li>
            <li><strong>Keywords:</strong> match transaction text and assign subcategory, WNI, tags, or ignored status. Matching ignores case, spaces, and accents, so the term "lekarna" also matches "LÉKÁRNA". The table shows each keyword's subcategory as Category › Subcategory.</li>
            <li><strong>App settings:</strong> set the dashboard default currency, review the exchange rate cache, and configure automatic internal-transfer handling.</li>
            <li><strong>Each table:</strong> the search box filters its rows, + Add opens the form for a new record, and every row has a pencil to edit it and a bin to delete it after a confirmation.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Import mappings">
          <p>
            An import mapping should represent one bank-export format. Use Detect columns with a sample
            CSV whenever possible, then inspect the parsed sample rows before saving.
          </p>
          <ul>
            <li><strong>Required fields:</strong> transaction date and amount must be mapped.</li>
            <li><strong>Description:</strong> can combine multiple CSV columns into the dashboard description.</li>
            <li><strong>Categorization fields:</strong> decide which parsed transaction fields Keywords inspect during import and recategorization.</li>
            <li><strong>Advanced parsing:</strong> delimiter, quote character, encoding, header row, date format, and decimal separator stay editable. The other mark (a dot when the decimal separator is a comma, and the reverse) may only group thousands, and spaces are ignored, so 1 234,50 and 1.234,50 both read as 1234.50 with comma decimals.</li>
            <li><strong>camt.053 XML:</strong> choose this format for ISO 20022 XML bank statements. Columns are mapped automatically, and the preview checks that the statement balances add up and that its account matches the bank account. A booking that bundles several payments becomes one transaction per payment when the statement lists each payment's amount; otherwise it stays one transaction with the total, and the preview says so.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Import">
          <p>
            The Import page is preview-first. The bank account you choose supplies the import
            mapping; there is no separate mapping picker.
          </p>
          <ol>
            <li>Choose the bank account. The line under it names the mapping the file is read with; if it shows a warning instead, set the account's default mapping in Definitions first.</li>
            <li>Choose the statement, a CSV file or camt.053 XML: click the file box, or drop the file on it.</li>
            <li>Run Preview. It shows the counts (rows, new, duplicates skipped, errors, uncategorized), the file's columns, and the first rows with their status.</li>
            <li>Import N rows saves the new rows: N leaves out duplicates and rows with errors.</li>
          </ol>
          <p>
            The preview, and after importing the import report, appear in one area under the steps.
            The report shows loaded, created, duplicate, and error counts and lists the rows that
            failed. An import where no row can be imported is refused and not kept, and its report
            says why.
          </p>
          <p>
            Recent imports lists the newest 8 imports; Show all lists every one. Report opens an
            import's report in the same area, and the bin deletes the import together with the
            transactions it created, for example to import the file again with a corrected mapping.
          </p>
          <p>
            Exchange rates sync automatically after imported transactions are saved. If the provider
            is unavailable, App settings in Definitions shows a retry action.
          </p>
        </HelpCard>

        <HelpCard title="Dashboard filters">
          <p>
            The filter bar at the top of the Dashboard controls the totals, charts, table, and actions.
            Actions apply only to the current filtered transactions.
          </p>
          <ul>
            <li><strong>Date range:</strong> From and To use the same YYYY-MM-DD format as the table. Type a date, or pick one with the calendar button in each field; the calendar shades the current range and works with the arrow keys. A typed date applies once it's complete. The quick picks next to the dates (This month, Last month, 3 months, 12 months, This year, All) set a range in one click.</li>
            <li><strong>Search:</strong> finds text in the description, notes, and counterparty, ignoring case, accents, and punctuation.</li>
            <li><strong>Filter buttons:</strong> Accounts, Categories, Subcategories, WNI, Direction, and Tags each open a checklist. A button shows what is selected (All, a name, or a count) and is highlighted while it narrows the results.</li>
            <li><strong>Saved filters:</strong> the menu next to the search box saves the current filters under a name, and loads or deletes saved ones.</li>
            <li><strong>Checklist filters:</strong> empty means show nothing. On startup, all checklist options are selected; Select all and Clear are at the top of each checklist.</li>
            <li><strong>Tag:</strong> starts empty, which means any tag. Click tags to show only transactions with at least one of them; a selected tag is filled in its colour, and clicking it again removes it. Tagged shows every transaction that has a tag, and Untagged every one without. Bulk assign and keyword rules pick tags the same way.</li>
            <li><strong>Category/Subcategory/WNI:</strong> subcategory options narrow automatically when categories are selected.</li>
            <li><strong>Direction:</strong> Incomes are positive transactions and Expenses are negative transactions.</li>
            <li><strong>View:</strong> includes ignored or locked transactions, and Divide by account owner count divides shared-account amounts by the account's owner count.</li>
            <li><strong>Clear filters:</strong> goes back to the filters the app starts with.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Totals, charts, and amount privacy">
          <p>
            Under the filter bar, a row of totals sums up the filtered transactions; below it, the
            Overview tab has the charts and the Transactions tab the table. The Dashboard opens on
            the tab you used last.
          </p>
          <ul>
            <li><strong>Totals:</strong> Income, Expenses, and Net with their monthly averages, Transactions (and how many there are in all), and Uncategorized, in the app default currency. Review under Uncategorized opens Review uncategorized.</li>
            <li><strong>Monthly flow:</strong> income up and expenses down for each month, with net as a line; hover a month for its numbers.</li>
            <li><strong>Expenses and income by category:</strong> categories as bars, largest first, with amount and share. Click a category to show its subcategories; one that makes up more than half of its side starts open. The Want / Need / Investment bar sits under the expenses.</li>
            <li><strong>Exchange rates:</strong> original imported amounts stay unchanged; converted totals use cached rates that sync after imports and default currency changes. In the table, a payment in another currency shows its original amount under the converted one, with the rate on hover.</li>
            <li><strong>Hide amounts:</strong> the eye button hides amount values on the dashboard and in imports; shares stay visible.</li>
            <li><strong>Accent and theme:</strong> use the sidebar footer controls for accent color and light/dark mode.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Editing transactions">
          <p>
            The table on the Transactions tab is editable where a small pencil appears in the header.
            Changes are saved immediately and the edited row updates in place. Category,
            subcategory, and WNI show a coloured dot, and a long description shows in full on hover.
          </p>
          <ul>
            <li><strong>Subcategory:</strong> edits the subcategory and therefore the derived category.</li>
            <li><strong>WNI:</strong> edits Want, Need, Investment, or blank.</li>
            <li><strong>Tags:</strong> opens the tag editor for multi-tag changes.</li>
            <li><strong>Ignored:</strong> toggles whether the transaction is excluded from normal analysis.</li>
            <li><strong>Locked:</strong> manually protect or unlock categorization.</li>
            <li><strong>Delete:</strong> the bin at the end of a row (it shows on hover or when the row is focused) deletes that transaction after a confirmation.</li>
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
            The toolbar above the table on the Transactions tab changes the filtered transactions.
            It shows how many there are; check that count before confirming any action.
          </p>
          <ul>
            <li><strong>Recategorize:</strong> reruns keyword matching for the filtered transactions.</li>
            <li><strong>Include locked:</strong> resets locked filtered transactions and lets recategorization overwrite them.</li>
            <li><strong>Bulk assign:</strong> updates subcategory, tags, WNI, ignored, or locked fields for all filtered transactions.</li>
            <li><strong>Delete filtered:</strong> deletes all filtered transactions after showing how many will go. It can't be undone; importing their files again brings them back.</li>
            <li><strong>Find transfers:</strong> previews likely transfers between defined accounts by matching opposite same-currency amounts across nearby dates. The Matched view lists applied transfers, and Unmatch restores what applying them changed.</li>
            <li><strong>Review uncategorized:</strong> reviews uncategorized transaction groups and creates keyword rules from suggested terms. Review under Uncategorized in the totals opens it too.</li>
          </ul>
        </HelpCard>

        <HelpCard title="Conflicts and uncategorized">
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
            <li><strong>Snapshot:</strong> the line at the top counts transactions, imports, definitions, transfer matches, exchange rates, saved filters, and sample records.</li>
            <li><strong>Export:</strong> downloads a SQLite backup of the current local database. <strong>Save backup</strong> keeps one in the app's table of saved backups instead (kind Manual), with Restore, Download, and a bin on each row.</li>
            <li><strong>Restore from a file:</strong> choose a backup file, then Restore database replaces the current database and saves a pre-restore backup automatically. A backup made by a newer version of Cashmoney is refused; update the app first.</li>
            <li><strong>Sample data:</strong> recreates or removes the demo dataset. Sample data, Danger zone, and Advanced fold away: click anywhere on their header.</li>
            <li><strong>Danger zone:</strong> delete sample data, all transactions, or all finance data. Before deleting all transactions or all finance data, a safety backup is saved automatically and listed under saved backups.</li>
            <li><strong>Saved backups:</strong> the app keeps the newest 10 pre-restore and 10 pre-delete backups, plus every one from the last 90 days, and deletes older ones when it saves a new one. Manual backups, files you put in the backups folder yourself, and exports you download are never deleted.</li>
            <li><strong>Advanced:</strong> <strong>Open database admin</strong> opens Django's admin in its own window, where any record can be edited directly, for fixes the app doesn't offer yet. It skips some of the app's checks. No password is needed, and access ends when Cashmoney closes.</li>
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
          {donationUrl && (
            <div className="help-support-panel">
              <div className="help-support-copy">
                <span aria-hidden="true" className="help-support-mark">
                  <CoffeeIcon />
                </span>
                <div>
                  <strong>Support me</strong>
                  <span>If you like Cashmoney, consider buying me a coffee.</span>
                </div>
              </div>
              <a className="primary-action help-support-button" href={donationUrl} rel="noreferrer" target="_blank">
                <CoffeeIcon />
                Buy me a coffee
              </a>
            </div>
          )}
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

function CoffeeIcon() {
  return (
    <svg aria-hidden="true" className="help-support-icon" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <path d="M10 2v2" />
      <path d="M14 2v2" />
      <path d="M4 8h12a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1Z" />
      <path d="M17 9h1a2 2 0 0 1 0 4h-1" />
      <path d="M6 18h8" />
      <path d="M6 22h8" />
    </svg>
  );
}
