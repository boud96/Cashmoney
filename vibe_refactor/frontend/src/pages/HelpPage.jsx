export default function HelpPage() {
  return (
    <div className="help-page">
      <section className="panel help-hero">
        <div>
          <h2>Cashmoney Help Guide</h2>
          <p>
            Cashmoney is a local desktop finance app for importing bank statement CSV files,
            automatically categorizing transactions, reviewing spending patterns, and maintaining
            your own finance definitions. The normal workflow is: define accounts and mappings,
            import CSV files, review the dashboard, adjust rules, then recategorize filtered
            transactions when your rules improve.
          </p>
        </div>
        <HelpScreenshot
          label="Screenshot placeholder"
          note="Add a full Dashboard screenshot here after the final layout is stable."
        />
      </section>

      <section className="help-grid">
        <article className="panel help-card">
          <h2>1. Set Up Definitions First</h2>
          <p>
            The Definitions page is where you create the objects the rest of the app depends on.
            You can add bank accounts, CSV mappings, categories, subcategories, tags, and keyword
            rules. The dashboard and import flow become much more useful once these are defined.
          </p>
          <ul>
            <li><strong>Bank Accounts:</strong> create one entry per account you import from. Use owner count for shared accounts.</li>
            <li><strong>CSV Mappings:</strong> describe how each bank statement format maps columns into transactions.</li>
            <li><strong>Categories:</strong> create broad reporting groups such as Food, Housing, Transport, or Income.</li>
            <li><strong>Subcategories:</strong> create the assignable child values, such as Groceries, Coffee, Rent, or Salary.</li>
            <li><strong>Tags:</strong> add flexible labels for cross-cutting topics like Vacation, Work, Cash, or Family.</li>
            <li><strong>Keywords:</strong> define text matching rules that categorize imported or existing transactions.</li>
          </ul>
          <HelpScreenshot
            label="Definitions screenshot"
            note="Capture the Definitions page showing several populated sections and the color picker."
          />
        </article>

        <article className="panel help-card">
          <h2>2. Create A CSV Mapping</h2>
          <p>
            A CSV mapping tells Cashmoney how to read a specific bank export. If different banks
            use different column names, separators, date formats, or decimal separators, create a
            separate mapping for each format.
          </p>
          <ol>
            <li>Open Definitions and find CSV Mappings.</li>
            <li>Fill in the mapping name and default currency.</li>
            <li>Choose a sample CSV file from that bank export.</li>
            <li>Use column detection to fill parsing settings and populate dropdown options from the actual CSV headers.</li>
            <li>Select which CSV columns map to transaction fields like date, description, amount, currency, and notes.</li>
            <li>Select categorization fields. These are the text fields Keywords will inspect.</li>
          </ol>
          <p>
            Advanced parsing settings remain editable if detection guesses a separator, header row, encoding, or date format incorrectly.
          </p>
        </article>

        <article className="panel help-card">
          <h2>3. Import A Bank Statement</h2>
          <p>
            The Import page loads a CSV statement into the local SQLite database. Each parsed row
            becomes a Transaction. During import, Cashmoney applies your current Keyword rules to
            assign subcategory, Want/Need/Investment, tags, or ignored status.
          </p>
          <ol>
            <li>Open Import.</li>
            <li>Choose the CSV file.</li>
            <li>Select the bank account.</li>
            <li>Cashmoney uses the selected bank account's default CSV mapping.</li>
            <li>Submit the import and review the report for created rows, duplicates, and errors.</li>
          </ol>
          <p>
            Duplicate detection helps prevent accidentally importing the same statement twice.
            Malformed or missing required CSV fields are reported so you can fix the mapping or
            the source file.
          </p>
          <HelpScreenshot
            label="Import screenshot"
            note="Capture the Import page with a selected CSV and an import result report."
          />
        </article>

        <article className="panel help-card">
          <h2>4. Understand Automatic Categorization</h2>
          <p>
            Keywords are matching rules. When transaction text contains the configured include
            terms and does not contain excluded terms, the rule can assign a subcategory, WNI value,
            tags, and ignored status. Higher priority rules win when more than one rule matches.
          </p>
          <ul>
            <li><strong>Subcategory:</strong> controls the derived Category shown in the table and charts.</li>
            <li><strong>WNI:</strong> classifies expenses as Want, Need, or Investment.</li>
            <li><strong>Tags:</strong> add one or more reusable labels to matching transactions.</li>
            <li><strong>Ignored:</strong> removes transactions such as own-account transfers from normal dashboard analysis.</li>
            <li><strong>Priority:</strong> helps resolve multiple matching rules.</li>
          </ul>
          <p>
            Good keyword rules are usually short and specific. For example, a rule matching a
            known merchant name should usually be more reliable than a broad word like payment.
          </p>
        </article>

        <article className="panel help-card help-card-wide">
          <h2>5. Review The Dashboard</h2>
          <p>
            The Dashboard is the main workspace. It combines filters, charts, a recategorization
            action, summary metrics, and an editable transaction table.
          </p>
          <div className="help-two-column">
            <div>
              <h3>Charts</h3>
              <ul>
                <li><strong>Monthly Flow:</strong> income is positive, expenses are negative, and net overlays the bars.</li>
                <li><strong>Income Categories:</strong> category and subcategory sunburst for income transactions.</li>
                <li><strong>Expense Categories:</strong> category and subcategory sunburst for expense transactions.</li>
                <li><strong>WNI:</strong> Want, Need, Investment, and Uncategorized distribution.</li>
                <li><strong>Top Expense Subcategories:</strong> the largest expense subcategories in the current filter scope.</li>
              </ul>
            </div>
            <div>
              <h3>Filters</h3>
              <ul>
                <li>Date range filters default from the oldest transaction to today.</li>
                <li>The Actions card can quickly show the last X days, weeks, or months.</li>
                <li>Account, Category, Subcategory, WNI, and Tag filters support multiple selections.</li>
                <li>Unassigned filter options help find uncategorized or untagged transactions.</li>
                <li>Search looks across relevant transaction text fields.</li>
              </ul>
            </div>
          </div>
          <HelpScreenshot
            label="Dashboard screenshot"
            note="Capture the Dashboard with filters open, charts visible, and a few rows in the transaction table."
          />
        </article>

        <article className="panel help-card">
          <h2>6. Edit Transactions In The Table</h2>
          <p>
            The Transactions table is meant for review and correction. Amounts are colored by
            direction. Category, Subcategory, and WNI cells use their assigned colors as cell
            backgrounds. Tags remain visible as colored labels.
          </p>
          <ul>
            <li><strong>Subcategory:</strong> edit with the dropdown to manually change the classification.</li>
            <li><strong>WNI:</strong> edit with the dropdown to choose Want, Need, Investment, or blank.</li>
            <li><strong>Tags:</strong> click the Tags cell to open the multi-tag editor, then Apply.</li>
            <li><strong>Ignored:</strong> use the checkbox to include or exclude a transaction from normal analysis.</li>
          </ul>
          <p>
            Saved table edits are written to the backend immediately. After a successful edit,
            the charts refresh so the dashboard stays in sync.
          </p>
        </article>

        <article className="panel help-card">
          <h2>7. Recategorize After Rule Changes</h2>
          <p>
            Recategorization is useful after you import transactions, notice many uncategorized
            rows, and then improve your Keyword rules. It only affects the transactions currently
            selected by the Dashboard filters.
          </p>
          <ol>
            <li>Filter the Dashboard to the transactions you want to update.</li>
            <li>Open Definitions and add or adjust Keywords.</li>
            <li>Return to Dashboard.</li>
            <li>Use Recategorize Filtered.</li>
            <li>Review the result counts and table changes.</li>
          </ol>
          <p>
            This makes it possible to recategorize one account, one month, one tag, or only
            uncategorized transactions instead of rewriting everything.
          </p>
        </article>

        <article className="panel help-card">
          <h2>8. Use Maintenance Carefully</h2>
          <p>
            Maintenance is for backups, restores, sample data, and destructive cleanup. It is
            useful during development and for local database management.
          </p>
          <ul>
            <li><strong>Database Snapshot:</strong> shows counts for transactions, imports, definitions, and sample data.</li>
            <li><strong>Export Backup:</strong> downloads a SQLite backup of the current database.</li>
            <li><strong>Restore Backup:</strong> replaces the current database from a backup file.</li>
            <li><strong>Recreate Samples:</strong> removes and recreates demo sample data.</li>
            <li><strong>Danger Zone:</strong> deletes sample data, all transactions, or all finance data.</li>
          </ul>
          <p>
            Export a backup before using Danger Zone actions. These actions affect the local
            database and are not meant as routine dashboard tools.
          </p>
          <HelpScreenshot
            label="Maintenance screenshot"
            note="Capture the Maintenance page showing Database Snapshot, Safe Tools, and Danger Zone."
          />
        </article>

        <article className="panel help-card">
          <h2>9. Troubleshooting</h2>
          <ul>
            <li><strong>CSV import has errors:</strong> check delimiter, header row, date format, decimal separator, and required column mapping.</li>
            <li><strong>Transactions are uncategorized:</strong> add Keywords, then recategorize the filtered transactions.</li>
            <li><strong>Charts look empty:</strong> check filters, include ignored setting, and date range.</li>
            <li><strong>Own-account transfers distort totals:</strong> add transfer Keywords that mark those transactions as ignored.</li>
            <li><strong>Wrong category appears:</strong> edit the transaction manually or adjust Keyword priority and recategorize.</li>
            <li><strong>Need to start over:</strong> export a backup first, then use Maintenance cleanup actions.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}

function HelpScreenshot({ label, note }) {
  return (
    <div className="help-screenshot">
      <div className="help-screenshot-label">{label}</div>
      <p>{note}</p>
    </div>
  );
}
