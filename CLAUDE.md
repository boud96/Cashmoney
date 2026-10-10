# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cashmoney is a local-first personal finance app for Windows: a Django + SQLite backend serves a JSON API and a React (Vite) SPA, and an Electron shell packages both into an installable desktop app. Users import bank CSVs, auto-categorize transactions with keyword rules, and review spending on a dashboard. Everything runs on `127.0.0.1`; there are no accounts or cloud services.

Session handoffs are in `.claude/handoffs/` (newest first). `.claude/notes/` holds finer product decisions, UI preferences and manual test checklists, and `.claude/reviews/bad_practices_review.md` tracks the security/quality backlog. The whole `.claude/` directory is gitignored, so these files exist only locally.

## Commands

The dev tooling is Windows `.bat` scripts at the repo root. Python is always `.venv\Scripts\python.exe`. Node comes from `PATH`, or from the portable copy in `tools\node` (`node.bat` / `npm.bat` wrap it).

```powershell
.\setup_dev.bat                 # create .venv, pip install backend/requirements.txt, npm install frontend+desktop
.\run_app.bat                   # setup + migrate + build frontend + runserver :8000 + open Electron (or browser)
.\build_frontend.bat --skip-setup   # Vite build into backend\finance\static\finance\react\
.\build_packaged_app.bat        # frontend + PyInstaller backend + electron-builder -> desktop\dist\
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

All backend tests are in `backend/finance/tests.py`. The classes are `ModelTests`, `SampleDataCommandTests`, `CSVImportServiceTests`, `CategorizationTests`, `APITests` and `MaintenanceRestoreTests`.

Lint/format: ruff via `.pre-commit-config.yaml` (`ruff --fix`, `ruff-format`). Ruff is not in `requirements.txt`. The frontend has no lint or test scripts. Verify frontend changes with a build (it already warns about a large chunk, so that warning is not a new problem).

There is no Vite dev-server proxy. `api.js` calls `/api` on the page's own origin, so the normal loop is: build the frontend, then load it from Django at `:8000`.

## Architecture

**Backend (`backend/`, single Django app `finance`)**
- `cashmoney_backend/settings.py` hardcodes `DEBUG`/`SECRET_KEY` and ignores the root `.env`. The DB is `DATA_DIR/db.sqlite3`, where `DATA_DIR = $CASHMONEY_DATA_DIR` or `backend/`. Time zone is `Europe/Prague`.
- `views.py`: the API is hand-rolled class-based views that subclass `JsonView`, not DRF. `JsonView.dispatch` turns exceptions into JSON errors: `APIValidationError(message, details)`, `KeyError` and `ValueError` → 400, `IntegrityError` → 409, `Http404` → 404. Validation therefore works by raising; don't build error responses by hand. Request bodies go through `parse_json_body`, and responses through `json_response` plus the `serialize_*` helpers in `serializers.py`.
- `services.py` holds the domain logic: CSV decoding/dialect/column detection and import, `CategorizationService` (active keywords by priority, include/exclude terms, targets subcategory/tags/WNI/ignored), Frankfurter exchange rates cached in `ExchangeRate`, ORM-aggregated dashboard summaries, and internal-transfer matching.
- `AppShellView` serves `templates/finance/app.html` and finds the hashed React bundle through the Vite manifest at `finance/static/finance/react/.vite/manifest.json`. That directory is generated and gitignored; never edit it by hand.
- `packaged_backend.py` is the PyInstaller entry point. It runs migrations, seeds sample data only if the DB is empty (`--skip-admin`), then starts `runserver` on `$CASHMONEY_PORT`.
- Maintenance endpoints (backup/restore/delete/admin user) require exact confirmation phrases (e.g. `RESTORE DATABASE`). A restore makes a pre-restore backup and then migrates, so schema changes must keep older SQLite backups restorable.

**Frontend (`frontend/src/`)**
- `App.jsx` owns global state: reference data (accounts, mappings, categories, tags, keywords, settings), the dashboard summary and transactions, theme/accent/hide-amounts, toasts and confirm dialogs. Pages under `pages/` are lazy-loaded and get data and reload callbacks from it.
- `api.js` is the only fetch layer (`apiGet`/`apiPost`/`apiPatch`/`apiDelete`).
- Put shared code in the shared modules instead of copying it into pages: formatting (`formatMoneyValue`, `formatCount`, …) and filter/chart/color helpers go in `shared.js`; UI primitives (`ModalShell`, `CloseButton`, `ConfirmDialog`, `HelpTooltip`, `Select`, `LoadingButton`, `Spinner`) are in `components.jsx`.
- The dashboard loads the summary and the transaction table separately. Table loads are delayed and debounced, and sequence refs drop stale responses. Transactions are capped at `limit=10000` (the backend maximum), and the UI warns when rows are left out. `raw_data` is not in list responses; it is fetched on demand from `/api/transactions/<id>/raw-data/`.

**Desktop (`desktop/main.js`)**
- In dev, Electron loads `http://127.0.0.1:8000`. When packaged, it starts the bundled backend exe on port 8765 with `CASHMONEY_DATA_DIR` set to Electron `userData`, so the DB and logs live there.
- External HTTP(S) links open in the system browser; same-origin links (including `/admin/`) stay in the app.

**Versioning and releases**
- The product version comes from `desktop/package.json` and `desktop/package-lock.json`. `frontend/vite.config.js` reads the lockfile to show the version in Help → About, so run `npm install` in `desktop/` after a bump. `frontend/package.json`'s version is not the product version.
- `.github/workflows/build-windows.yml` builds on PRs into `main` and on manual runs, not on pushes to `main`. A pushed `vX.Y.Z` tag publishes `Cashmoney-Setup.exe`, `Cashmoney-Portable.exe` and `checksums.txt` to a GitHub Release; README download links depend on those names. To release, merge to `main`, then tag that exact `main` commit.
- Git flow: feature work on `develop` → PR to `main`.

## Project-specific rules

- Never add default or hardcoded Django admin credentials. Admin users are created or reset only through Maintenance → Danger Zone (`/api/maintenance/admin-user/`). That form has no email field.
- The donation panel appears only in Help → About. It is enabled by the build-time `VITE_CASHMONEY_DONATION_URL` (a public Stripe Payment Link set as a GitHub repo *Variable*). Keep the copy short and factual, never add Stripe secrets, and never add floating widgets.
- UI conventions: dashboard action buttons use `link-button`. Explanatory text goes under modal titles. Empty tag cells show no placeholder pills. Edits update grid rows in place (no full reload or scroll-to-top); a row edited out of the active filters stays visible, highlighted, until the next refresh. Follow the existing card/form CSS patterns in `styles.css`, because mid-width layout overlap has been a past problem.
- Money is stored as `Decimal`, but the API currently serializes it as floats (a known issue).
- The root `.env`, root `db.sqlite3`, and the `docker`/`llm-categorization` branches belong to the old pre-rewrite Streamlit/Postgres app. The current app doesn't use them or Docker.
- `data/` (gitignored) and stray bank exports at the repo root (e.g. `creditasone*`, which are not ignored) contain real personal bank data. Never commit them.
