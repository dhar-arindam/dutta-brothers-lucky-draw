import { HelpCircle, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import './admin.tailwind.css';

const sectionClass =
  'rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)]';
const linkClass = 'font-semibold text-[#1557c0] underline underline-offset-2';

export const AdminHelpPage = () => {
  const [isLightTheme, setIsLightTheme] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('dutta-draw-admin-theme') !== 'dark';
  });

  useEffect(() => {
    window.localStorage.setItem('dutta-draw-admin-theme', isLightTheme ? 'light' : 'dark');
  }, [isLightTheme]);

  return (
    <main
      className={`admin-help-page ${isLightTheme ? 'admin-help-light' : 'admin-help-dark'} min-h-screen px-3 py-4 sm:px-5`}
      aria-label="Admin user guide"
    >
      <div className="mx-auto grid w-full max-w-5xl gap-4">
        <header className="admin-help-header relative rounded-xl bg-[#1557c0] px-5 py-5 text-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
          <div className="admin-help-header-content">
            <div>
              <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-blue-100">
                Dutta Brothers
              </p>
              <h1 className="m-0 mt-1 text-3xl font-semibold">Admin user guide</h1>
              <p className="m-0 mt-2 max-w-2xl text-sm text-blue-100">
                Practical instructions for running the campaign, managing prizes, reviewing claims,
                and conducting year-end Mega Draw cycles.
              </p>
            </div>
            <div className="admin-help-header-actions">
              <a
                href="/admin"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-100/70 bg-white px-4 text-sm font-semibold text-[#24415f] no-underline"
              >
                Back to Admin
              </a>
              <button
                type="button"
                className="admin-help-link"
                onClick={() => setIsLightTheme((current) => !current)}
                aria-label={isLightTheme ? 'Switch to Dark' : 'Switch to Light'}
                title={isLightTheme ? 'Switch to Dark' : 'Switch to Light'}
              >
                {isLightTheme ? (
                  <Moon aria-hidden="true" size={18} />
                ) : (
                  <Sun aria-hidden="true" size={18} />
                )}
              </button>
            </div>
          </div>
        </header>

        <nav className={`${sectionClass} admin-help-surface`} aria-label="Guide contents">
          <h2 className="m-0 text-base font-semibold uppercase tracking-[0.04em]">Contents</h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <a className={linkClass} href="#getting-started">
              Getting started
            </a>
            <a className={linkClass} href="#campaign">
              Campaign configuration
            </a>
            <a className={linkClass} href="#prizes">
              Prize management
            </a>
            <a className={linkClass} href="#claims">
              Claims and exports
            </a>
            <a className={linkClass} href="#mega-draw">
              Mega Draw
            </a>
            <a className={linkClass} href="#cycles">
              Cycles, reset, and reopen
            </a>
            <a className={linkClass} href="#troubleshooting">
              Troubleshooting
            </a>
          </div>
        </nav>

        <section id="getting-started" className={`${sectionClass} admin-help-surface`}>
          <h2 className="m-0 text-xl font-semibold">Getting started</h2>
          <ol className="mt-3 grid gap-2 pl-5 text-sm leading-6">
            <li>
              Open <strong>/admin</strong> and sign in with an Admin account when prompted.
            </li>
            <li>
              Use the <strong>Refresh</strong> button whenever you need the latest operational data.
            </li>
            <li>
              Use the <strong>?</strong> help icon in the top-right corner to return to this guide.
            </li>
            <li>
              Use <strong>Sign out</strong> when leaving a shared or operational device.
            </li>
          </ol>
          <p className="admin-help-muted mb-0 mt-3 text-sm">
            Ordinary dashboard reads may be available without sign-in, but edits, exports, and all
            Mega Draw operations require an Admin-scoped session.
          </p>
        </section>

        <section id="campaign" className={`${sectionClass} admin-help-surface`}>
          <h2 className="m-0 text-xl font-semibold">Campaign configuration</h2>
          <p className="mt-3 text-sm leading-6">
            The campaign period controls when customer participation is allowed. Set both dates in
            <strong> Campaign Configuration</strong>, then select <strong>Save</strong>.
          </p>
          <ul className="mt-2 grid gap-2 pl-5 text-sm leading-6">
            <li>
              <strong>From Date</strong> is the first campaign date.
            </li>
            <li>
              <strong>To Date</strong> is the final campaign date.
            </li>
            <li>The end date cannot be earlier than the start date.</li>
            <li>Dates are interpreted in Asia/Kolkata time.</li>
            <li>
              The status panel shows whether the campaign is not configured, not started, active, or
              ended.
            </li>
          </ul>
          <p className="admin-help-muted mb-0 mt-3 text-sm">
            Customer draws are blocked after the configured campaign end. Mega Draw preparation is
            also blocked until the relevant campaign has ended.
          </p>
        </section>

        <section id="prizes" className={`${sectionClass} admin-help-surface`}>
          <h2 className="m-0 text-xl font-semibold">Prize management</h2>
          <p className="mt-3 text-sm leading-6">
            Use <strong>Prize Management</strong> to maintain the regular lucky-draw prizes.
          </p>
          <ul className="mt-2 grid gap-2 pl-5 text-sm leading-6">
            <li>Add a prize with a name and positive relative weight.</li>
            <li>Toggle whether a prize is active for future customer draws.</li>
            <li>
              Save a changed weight with that prize&apos;s <strong>Save Weight</strong> button.
            </li>
            <li>Prize names are fixed after creation and cannot be renamed.</li>
            <li>
              Changing a prize affects future selection only; existing claims preserve their awarded
              prize.
            </li>
          </ul>
        </section>

        <section id="claims" className={`${sectionClass} admin-help-surface`}>
          <h2 className="m-0 text-xl font-semibold">Claims and exports</h2>
          <p className="mt-3 text-sm leading-6">
            The Claims section shows successful customer draws newest first. Use the controls above
            the table to narrow the list.
          </p>
          <ol className="mt-2 grid gap-2 pl-5 text-sm leading-6">
            <li>
              Enter customer text in <strong>Search</strong>, or select a prize.
            </li>
            <li>Optionally choose a From Date and To Date filter.</li>
            <li>
              Select <strong>Apply Filters</strong> to load matching claims.
            </li>
            <li>
              Select <strong>Export Data</strong> and choose a year to download the approved CSV.
            </li>
            <li>
              Use a claim&apos;s <strong>Delete</strong> action only when the claim must be removed
              or archived according to the campaign state.
            </li>
            <li>
              Use <strong>Clear All Claims</strong> only after reviewing its confirmation dialog.
            </li>
          </ol>
          <p className="admin-help-muted mb-0 mt-3 text-sm">
            After the campaign ends, deletion archives claims rather than removing their audit
            record. Archived claims are excluded from normal claims views and CSV exports.
          </p>
        </section>

        <section id="mega-draw" className={`${sectionClass} admin-help-surface`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-xl font-semibold">Mega Draw</h2>
              <p className="mb-0 mt-2 text-sm leading-6">
                Open Mega Draw from the Admin dashboard. It is an Admin-only year-end operation and
                selects distinct winners from eligible customer claims.
              </p>
            </div>
            <a
              href="/admin/mega-draw"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#cfd9e5] bg-white px-4 text-sm font-semibold text-[#24415f] no-underline"
            >
              Open Mega Draw
            </a>
          </div>
          <details className="admin-help-surface mt-4 rounded-lg border p-4" open>
            <summary className="cursor-pointer font-semibold">Configure prizes</summary>
            <ol className="mt-3 grid gap-2 pl-5 text-sm leading-6">
              <li>Add between 1 and 10 Mega prizes.</li>
              <li>Enter unique, non-blank prize names.</li>
              <li>Reorder prizes with the up and down controls.</li>
              <li>
                Select <strong>Save configuration</strong> and wait for the success toast.
              </li>
            </ol>
          </details>
          <details className="admin-help-surface mt-3 rounded-lg border p-4">
            <summary className="cursor-pointer font-semibold">Prepare and draw winners</summary>
            <ol className="mt-3 grid gap-2 pl-5 text-sm leading-6">
              <li>
                Select <strong>Prepare draw</strong> after the campaign has ended.
              </li>
              <li>Review the eligible candidate count and the prize order.</li>
              <li>Open the preparation ceremony and click the wheel to draw the next prize.</li>
              <li>
                Prizes are selected in reverse configured order, starting with the last configured
                prize.
              </li>
              <li>Wait for the authoritative winner result before starting the next selection.</li>
              <li>Each candidate identity can win only once within a cycle.</li>
              <li>After the last prize, review the chronological winner list.</li>
            </ol>
          </details>
          <details className="admin-help-surface mt-3 rounded-lg border p-4">
            <summary className="cursor-pointer font-semibold">Close a cycle</summary>
            <p className="mb-0 mt-3 text-sm leading-6">
              When all prizes are selected, choose <strong>Close Mega Draw</strong>, acknowledge the
              warning, and type the exact confirmation phrase shown. Closing preserves the results
              and close time and prevents more selections in that cycle.
            </p>
          </details>
        </section>

        <section id="cycles" className={`${sectionClass} admin-help-surface`}>
          <h2 className="m-0 text-xl font-semibold">Cycles, reset, and reopen</h2>
          <ul className="mt-3 grid gap-2 pl-5 text-sm leading-6">
            <li>
              <strong>Reset Mega Draw</strong> is for an active setup, in-progress, or completed
              cycle. It clears that active cycle&apos;s selections but keeps its editable prize
              configuration. Reset does not create history.
            </li>
            <li>
              <strong>Reopen/New Cycle</strong> appears only after the current cycle is closed. It
              creates the next numbered cycle and keeps the closed cycle preserved.
            </li>
            <li>
              Winners from every earlier closed cycle remain in the history and are not eligible for
              a later cycle.
            </li>
            <li>
              Closed cycles appear in collapsed panels showing the cycle number and close time.
              Expand a panel to review its winners.
            </li>
            <li>
              A new cycle gets its own preflight, selection progress, reference, winners, and close
              time.
            </li>
          </ul>
        </section>

        <section id="troubleshooting" className={`${sectionClass} admin-help-surface`}>
          <h2 className="m-0 text-xl font-semibold">Troubleshooting</h2>
          <dl className="mt-3 grid gap-3 text-sm leading-6">
            <div>
              <dt className="font-semibold">Admin request failed or shows 502</dt>
              <dd className="admin-help-muted m-0">
                Confirm the backend API is running and refresh the page. For local testing, start
                the backend with APP_RUNTIME=LOCAL.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Mega Draw cannot be prepared</dt>
              <dd className="admin-help-muted m-0">
                Check that the campaign has ended, prizes are configured, and enough eligible
                candidates exist for every prize.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Configuration is locked</dt>
              <dd className="admin-help-muted m-0">
                A winner has already been selected. Use Reset for the active cycle, or close the
                completed cycle and use Reopen/New Cycle for a new one.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Changes are not visible</dt>
              <dd className="admin-help-muted m-0">
                Select Refresh. Browser data is not a substitute for the backend&apos;s
                authoritative state.
              </dd>
            </div>
          </dl>
        </section>

        <footer className="admin-help-muted px-1 pb-4 text-xs">
          <span className="inline-flex items-center gap-1">
            <HelpCircle aria-hidden="true" size={14} /> Admin guide
          </span>
          <span className="ml-2">
            Keep operational actions deliberate: configuration, deletion, reset, and close
            operations affect future draw behavior.
          </span>
        </footer>
      </div>
    </main>
  );
};
