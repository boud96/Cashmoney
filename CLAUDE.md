# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cashmoney is a local-first personal finance app for Windows: a Django + SQLite backend serves a JSON API and a React (Vite) SPA, and an Electron shell packages both into an installable desktop app. Users import bank CSVs, auto-categorize transactions with keyword rules, and review spending on a dashboard. Everything runs on `127.0.0.1`; there are no accounts or cloud services.

Session handoffs are in `.claude/handoffs/` (newest first). `.claude/notes/` holds finer product decisions, UI preferences, manual test checklists and the ideas list. `.claude/reviews/code_review_2026-10-11.md` is the current review and open-findings backlog (CR-n and BP#n numbers; older review files are kept for history). `.claude/tools/` has a headless-Chrome UI check harness and dev-DB analysis scripts (see its README). The whole `.claude/` directory is gitignored, so these files exist only locally.

## Commands

The dev tooling is Windows `.bat` scripts at the repo root. Python is always `.venv\Scripts\python.exe`. Node comes from `PATH`, or from the portable copy in `tools\node` (`node.bat` / `npm.bat` wrap it).

```powershell
.\setup_dev.bat                 # create .venv, pip install backend/requirements.txt, npm ci frontend+desktop (if missing)
.\run_app.bat                   # setup + migrate + build frontend + runserver :8000 + open Electron (or browser)
.\build_frontend.bat --skip-setup   # Vite build into backend\finance\static\finance\react\
.\build_packaged_app.bat        # frontend + PyInstaller backend (pinned in backend\requirements-build.txt) + electron-builder -> desktop\dist\
.\node.bat --check desktop\main.js  # Electron syntax check
```

Backend (run from `backend\`):

```powershell
..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
..\.venv\Scripts\python.exe manage.py test finance                                   # all tests
..\.venv\Scripts\python.exe manage.py test finance.tests.APITests                    # one class
..\.venv\Scripts\python.exe manage.py test finance.tests.APITests.test_some_method   # one test
..\.venv\Scripts\python.exe manage.py seed_sample_data --if-empty --skip-admin
```

All backend tests are in `backend/finance/tests.py`. The main classes are `ModelTests`, `SampleDataCommandTests`, `CSVImportServiceTests`, `CategorizationTests`, `APITests` and `MaintenanceRestoreTests`; smaller ones cover the camt.053 parser, migrations and the secret key.

Lint/format: ruff via `.pre-commit-config.yaml` (`ruff --fix`, `ruff-format`). Ruff is not in `requirements.txt`. The frontend has `npm run lint` (ESLint; it catches undefined names, which the build doesn't, plus the hooks rules; the existing `exhaustive-deps` warnings are known) and `npm test` (Vitest, `src/*.test.js`, currently `shared.js` helpers). Run both from `frontend/` and build. CI runs them and the backend tests before the build. A build alone doesn't prove a page renders, so check UI changes in a browser.

There is no Vite dev-server proxy. `api.js` calls `/api` on the page's own origin, so the normal loop is: build the frontend, then load it from Django at `:8000`.

## Architecture

**Backend (`backend/`, single Django app `finance`)**
- `cashmoney_backend/settings.py` ignores the root `.env`. The DB is `DATA_DIR/db.sqlite3`, where `DATA_DIR = $CASHMONEY_DATA_DIR` or `backend/`. `DEBUG` comes from `CASHMONEY_DEBUG` (on unless set to `0`; the packaged app turns it off). `SECRET_KEY` is per install, kept in `DATA_DIR/secret_key.txt` (gitignored; `CASHMONEY_SECRET_KEY` overrides). WhiteNoise serves static files straight from the app folders. Time zone is `Europe/Prague`. SQLite runs with `transaction_mode: IMMEDIATE` and a 20 s `timeout`: with deferred transactions, a write that had already read failed at once while another request was writing (`.claude/tools/analysis/lock_check.py` reproduces it).
- `views.py`: the API is hand-rolled class-based views that subclass `JsonView`, not DRF. `JsonView.dispatch` turns exceptions into JSON errors: `APIValidationError(message, details)`, `KeyError` and `ValueError` → 400, `IntegrityError` → 409, `Http404` → 404. Validation therefore works by raising; don't build error responses by hand. Request bodies go through `parse_json_body`, and responses through `json_response` plus the `serialize_*` helpers in `serializers.py`.
- `services.py` holds the domain logic: CSV decoding/dialect/column detection and import, `CategorizationService` (active keywords by priority, include/exclude terms, targets subcategory/tags/WNI/ignored), Frankfurter exchange rates cached in `ExchangeRate`, ORM-aggregated dashboard summaries, and internal-transfer matching. Provider calls run inside requests, so they time out after 5 s, a network failure skips the provider for 5 minutes (the explicit sync retries at once), and the currency list is cached for a day. An import that imports nothing (every row failed, an empty or unreadable file) answers 400 with its report and keeps no `CSVImport`; reports list at most 100 failed rows (`skipped.error_count` has the total).
- Transaction search ignores case, accents and punctuation: `search.py` `fold_search_text` is a SQLite function plus the `searchfold` lookup, registered in `models.py`. Keyword matching ignores whitespace, case and accents but keeps punctuation (`normalize_keyword_text` in `services.py`). Filter semantics live only in `filtered_transactions`; after a row edit the PATCH response carries `matches_filters`, which the dashboard uses to keep an edited-out row highlighted. Checklist filters have pseudo values: `__unassigned__` (e.g. Untagged), `__none__` (nothing selected) and, for tags only, `__any__` (Tagged).
- `AppShellView` serves `templates/finance/app.html` and finds the hashed React bundle through the Vite manifest at `finance/static/finance/react/.vite/manifest.json`. That directory is generated and gitignored; never edit it by hand.
- `packaged_backend.py` is the PyInstaller entry point. It sets `CASHMONEY_DEBUG=0`, runs migrations, seeds sample data only if the DB is empty (`--skip-admin`), then serves the app with waitress on `$CASHMONEY_PORT`. `run_app.bat` keeps using `runserver` for development.
- Maintenance endpoints (backup/restore/delete/admin user) require exact confirmation phrases (e.g. `RESTORE DATABASE`). A restore makes a pre-restore backup and then migrates, so schema changes must keep older SQLite backups restorable. Restores and "Delete all" save safety backups in `DATA_DIR/backups/`; `prune_safety_backups` then keeps the newest 10 of that kind plus any from the last 90 days, and never touches files it didn't name.

**Frontend (`frontend/src/`)**
- `App.jsx` owns global state: reference data (accounts, mappings, categories, tags, keywords, settings), the dashboard summary and transactions, theme/accent/hide-amounts, toasts and confirm dialogs. Pages under `pages/` are lazy-loaded and get data and reload callbacks from it.
- `api.js` is the only fetch layer (`apiGet`/`apiPost`/`apiPatch`/`apiDelete`). A failed request's error carries the JSON body as `error.payload`; when requests stop reaching the backend at all, it fires `BACKEND_REACHABILITY_EVENT` and App shows the offline banner.
- Put shared code in the shared modules instead of copying it into pages: formatting (`formatMoneyValue`, `formatCount`, …) and filter/chart/color helpers go in `shared.js`; UI primitives (`ModalShell`, `CloseButton`, `ConfirmDialog`, `HelpTooltip`, `Select`, `LoadingButton`, `Spinner`) are in `components.jsx`.
- The dashboard loads the summary and the transaction table separately. Table loads are delayed and debounced, and sequence refs drop stale responses. Transactions are capped at `limit=10000` (the backend maximum), and the UI warns when rows are left out. `raw_data` is not in list responses; it is fetched on demand from `/api/transactions/<id>/raw-data/`.

**Desktop (`desktop/main.js`)**
- In dev, Electron loads `http://127.0.0.1:8000`. When packaged, it starts the bundled backend exe on port 8765 with `CASHMONEY_DATA_DIR` set to Electron `userData`, so the DB and logs live there.
- External HTTP(S) links open in the system browser; same-origin links (including `/admin/`) stay in the app.

**Versioning and releases**
- The product version comes from `desktop/package.json` and `desktop/package-lock.json`. `frontend/vite.config.js` reads the lockfile to show the version in Help → About, so run `npm install` in `desktop/` after a bump. `frontend/package.json`'s version is not the product version.
- `.github/workflows/build-windows.yml` builds on PRs into `main` and on manual runs, not on pushes to `main`. A pushed `vX.Y.Z` tag publishes `Cashmoney-Setup.exe`, `Cashmoney-Portable.exe` and `checksums.txt` to a GitHub Release (from a separate `publish-release` job; the build job has read-only access); README download links depend on those names. To release, merge to `main`, then tag that exact `main` commit.
- Git flow: feature work on `develop` → PR to `main`.

## Project-specific rules

- Never add default or hardcoded Django admin credentials. Admin users are created or reset only through Maintenance → Danger Zone (`/api/maintenance/admin-user/`). That form has no email field.
- The donation panel appears only in Help → About. It is enabled by the build-time `VITE_CASHMONEY_DONATION_URL` (a public Stripe Payment Link set as a GitHub repo *Variable*). Keep the copy short and factual, never add Stripe secrets, and never add floating widgets.
- UI conventions: dashboard action buttons use `link-button`. Explanatory text goes under modal titles. Empty tag cells show no placeholder pills. Edits update grid rows in place (no full reload or scroll-to-top); a row edited out of the active filters stays visible, highlighted, until the next refresh. Follow the existing card/form CSS patterns in `styles.css`, because mid-width layout overlap has been a past problem.
- Keyboard focus: a busy `LoadingButton` stays focusable (`aria-disabled`) so focus can return to it after a dialog; only busy submit buttons are disabled. AG Grid `columnDefs` must not depend on callbacks that change every render (the Definitions grids read theirs through a ref): new columns rebuild the cells and drop focus.
- Money is stored as `Decimal`, and the API sends it as two-place decimal strings (`"-12.50"`, `serializers.money()`). Never send money as floats. The frontend converts with `Number()` only at the edges: the formatters, chart inputs, and the grid's `compareAmounts`. SQLite stores whole amounts as integers, so SQL arithmetic on amounts must not divide integers (see the owner split in `build_dashboard_summary`).
- The root `.env`, root `db.sqlite3`, and the `docker`/`llm-categorization` branches belong to the old pre-rewrite Streamlit/Postgres app. The current app doesn't use them or Docker.
- `data/` (gitignored) and stray bank exports at the repo root (e.g. `creditasone*`, which are not ignored) contain real personal bank data. Never commit them.
