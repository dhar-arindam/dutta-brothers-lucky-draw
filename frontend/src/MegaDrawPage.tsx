import { FormEvent, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, RotateCcw, Save } from 'lucide-react';

import type { MegaDrawLifecycle, MegaDrawPreflight } from './types';
import {
  drawNextMegaPrize,
  getMegaDraw,
  getMegaDrawStatus,
  MegaDrawApiError,
  prepareMegaDraw,
  resetMegaDraw,
  saveMegaDrawConfiguration,
} from './services/mega-draw-api';
import './admin.tailwind.css';

type Dialog = 'RUN' | 'RESET' | null;
type UiState =
  | 'LOADING'
  | 'SETUP'
  | 'PREFLIGHT_READY'
  | 'PREFLIGHT_STALE'
  | 'RUNNING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'RESETTING'
  | 'ERROR';

const createKey = (): string => crypto.randomUUID();
const formatKolkata = (timestamp: string): string =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(timestamp));

export const MegaDrawPage = () => {
  const [isLightTheme, setIsLightTheme] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('dutta-draw-admin-theme') !== 'dark';
  });
  const [uiState, setUiState] = useState<UiState>('LOADING');
  const [prizeNames, setPrizeNames] = useState<string[]>(['']);
  const [preflight, setPreflight] = useState<MegaDrawPreflight | null>(null);
  const [lifecycle, setLifecycle] = useState<MegaDrawLifecycle | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const load = async (successMessage = 'Mega Draw configuration loaded.') => {
    setUiState('LOADING');
    try {
      const response = await getMegaDraw();
      setPrizeNames(
        response.configuration.length ? response.configuration.map((prize) => prize.name) : [''],
      );
      setLifecycle(response.lifecycle ?? null);
      setUiState(
        response.lifecycle?.status === 'COMPLETED'
          ? 'COMPLETED'
          : response.lifecycle?.status === 'IN_PROGRESS'
            ? 'IN_PROGRESS'
            : 'SETUP',
      );
      setMessage(response.lifecycle ? 'Mega Draw lifecycle loaded.' : successMessage);
    } catch (error) {
      setUiState('ERROR');
      setMessage(error instanceof Error ? error.message : 'Unable to load Mega Draw.');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    window.localStorage.setItem('dutta-draw-admin-theme', isLightTheme ? 'light' : 'dark');
  }, [isLightTheme]);
  useEffect(() => {
    if ((uiState === 'IN_PROGRESS' || uiState === 'COMPLETED') && lifecycle) {
      const timer = window.setTimeout(() => headingRef.current?.focus(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [uiState, lifecycle]);
  const validatePrizes = (): boolean => {
    const errors: Record<number, string> = {};
    const seen = new Set<string>();
    prizeNames.forEach((name, index) => {
      const normalized = name.trim();
      if (!normalized) errors[index] = 'Prize name is required.';
      else if (normalized.length > 100)
        errors[index] = 'Prize name must be at most 100 characters.';
      else if (seen.has(normalized.toLocaleLowerCase()))
        errors[index] = 'Prize names must be unique.';
      seen.add(normalized.toLocaleLowerCase());
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };
  const saveConfiguration = async (event: FormEvent) => {
    event.preventDefault();
    if (!validatePrizes()) return;
    try {
      const response = await saveMegaDrawConfiguration(prizeNames.map((name) => name.trim()));
      setPrizeNames(response.prizes.map((prize) => prize.name));
      setPreflight(null);
      setUiState('SETUP');
      setMessage('Mega prize configuration saved. Prepare a new draw snapshot.');
    } catch (error) {
      setUiState('ERROR');
      setMessage(error instanceof Error ? error.message : 'Unable to save configuration.');
    }
  };
  const prepare = async () => {
    try {
      const response = await prepareMegaDraw();
      setPreflight(response.preflight);
      setUiState('PREFLIGHT_READY');
      setMessage('Preflight is ready. Review and confirm the Mega Draw.');
    } catch (error) {
      const apiError = error instanceof MegaDrawApiError ? error : null;
      setUiState(apiError?.code === 'PREFLIGHT_STALE' ? 'PREFLIGHT_STALE' : 'ERROR');
      setMessage(error instanceof Error ? error.message : 'Unable to prepare Mega Draw.');
    }
  };
  const openDialog = (next: Exclude<Dialog, null>) => {
    setDialog(next);
    setAcknowledged(false);
    setConfirmation('');
  };
  const expectedConfirmation =
    dialog === 'RUN'
      ? `DRAW NEXT MEGA PRIZE ${lifecycle?.executionYear ?? preflight?.executionYear}`
      : `RESET MEGA DRAW ${lifecycle?.executionYear}`;
  const canSubmit = acknowledged && confirmation === expectedConfirmation;
  const complete = (updatedLifecycle: MegaDrawLifecycle) => {
    setLifecycle(updatedLifecycle);
    setDialog(null);
    setAttemptKey(null);
    setUiState(updatedLifecycle.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS');
    setMessage(`Winner recorded. ${updatedLifecycle.remainingPrizes.length} prizes remain.`);
  };
  const recover = async (key: string): Promise<boolean> => {
    const status = await getMegaDrawStatus(key);
    if (status.execution === 'COMPLETED' && status.lifecycle) {
      complete(status.lifecycle);
      return true;
    }
    if (status.execution === 'IN_PROGRESS') {
      setUiState('ERROR');
      setMessage(
        'The Mega Draw is still being finalized. Check the attempt status again before retrying.',
      );
      return true;
    }
    return false;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !dialog) return;
    const operation = dialog;
    if (operation === 'RESET') {
      setUiState('RESETTING');
      try {
        await resetMegaDraw({ acknowledgement: acknowledged, confirmation });
        setDialog(null);
        setAttemptKey(null);
        setPreflight(null);
        setLifecycle(null);
        await load('Mega Draw reset. Configure prizes for the new draw.');
      } catch (error) {
        setUiState('ERROR');
        setMessage(
          error instanceof Error ? error.message : 'Mega Draw reset could not be completed.',
        );
      }
      return;
    }
    const key = attemptKey ?? createKey();
    setAttemptKey(key);
    setUiState('RUNNING');
    try {
      if (attemptKey && (await recover(key))) return;
      const response = await drawNextMegaPrize(
        {
          ...(lifecycle ? {} : { preflightReference: preflight!.reference }),
          acknowledgement: acknowledged,
          confirmation,
        },
        key,
      );
      complete(response.lifecycle);
    } catch (error) {
      const apiError = error instanceof MegaDrawApiError ? error : null;
      if (apiError?.code === 'PREFLIGHT_STALE') {
        setDialog(null);
        setPreflight(null);
        setUiState('PREFLIGHT_STALE');
        return;
      }
      try {
        if (await recover(key)) return;
      } catch {
        // Preserve the request failure when its status cannot be recovered.
      }
      setUiState('ERROR');
      setMessage(
        error instanceof Error ? error.message : 'Mega Draw execution could not be completed.',
      );
    }
  };
  const movePrize = (index: number, offset: number) =>
    setPrizeNames((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  const replacePrize = (index: number, value: string) =>
    setPrizeNames((current) =>
      current.map((name, position) => (position === index ? value : name)),
    );
  const isLocked = Boolean(lifecycle);
  const blocked = preflight && preflight.candidateCount < preflight.prizes.length;
  const shellClass = isLightTheme
    ? 'mega-draw-light min-h-screen bg-[#f3f6fa] px-3 py-4 text-slate-800 sm:px-5'
    : 'min-h-screen bg-[#0f1224] px-3 py-4 text-[#ffeecf] sm:px-5';
  const panelClass = isLightTheme
    ? 'mx-auto w-full max-w-6xl rounded-2xl border border-[#d9e2ec] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.08)] sm:p-5'
    : 'mx-auto w-full max-w-6xl rounded-2xl border border-amber-300/25 bg-[#151933] p-4 shadow-[0_8px_18px_rgba(0,0,0,0.35)] sm:p-5';
  const headingTextClass = isLightTheme ? 'text-slate-900' : 'text-amber-100';
  const mutedTextClass = isLightTheme ? 'text-slate-600' : 'text-amber-100/80';
  const sectionBorderClass = isLightTheme ? 'border-slate-300/70' : 'border-amber-300/30';
  const surfaceClass = isLightTheme
    ? 'border border-solid border-[#d9e2ec] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]'
    : 'border-2 border-solid border-[#d4af37] bg-[#11153b]';
  const inputClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#cfd9e5] bg-[#f5f8fc] px-3 text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c7] focus-visible:ring-offset-2 focus-visible:ring-offset-white'
    : 'min-h-10 rounded-lg border border-amber-300/35 bg-[#141338] px-3 text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933]';
  const primaryButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#1557c0] bg-[#1557c0] px-4 text-sm font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c7] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:border-[#9fb9dc] disabled:bg-[#cbd9ec] disabled:text-slate-500'
    : 'min-h-10 rounded-lg border border-amber-200 bg-amber-100 px-4 text-sm font-semibold text-[#1f1030] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-amber-200/40 disabled:bg-amber-200/40 disabled:text-[#1f1030]/60';
  const secondaryButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#cfd9e5] bg-white px-4 text-sm font-semibold text-[#24415f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c7] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:border-[#d9e2ec] disabled:bg-[#f1f4f8] disabled:text-slate-500'
    : 'min-h-10 rounded-lg border border-amber-200/70 bg-[#1b1849] px-4 text-sm font-semibold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-amber-200/30 disabled:bg-[#1b1849]/60 disabled:text-amber-100/60';
  const dangerButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:border-red-200/50 disabled:bg-red-50/60 disabled:text-red-700/50'
    : 'min-h-10 rounded-lg border border-red-400/70 bg-red-950/40 px-4 text-sm font-semibold text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-red-400/30 disabled:bg-red-950/20 disabled:text-red-200/50';
  return (
    <main className={shellClass} aria-label="Mega Draw operations page">
      <section className={panelClass}>
        <header
          className={`relative flex flex-wrap items-start justify-between gap-3 rounded-xl px-4 py-3 ${isLightTheme ? 'bg-[#1557c0] text-white' : ''}`}
        >
          <div className="grid gap-1">
            <p
              className={`m-0 text-xs font-bold uppercase tracking-[0.16em] ${isLightTheme ? 'text-blue-100' : 'text-amber-300'}`}
            >
              Dutta Brothers
            </p>
            <h1
              className={`m-0 text-2xl font-semibold uppercase tracking-[0.04em] sm:text-3xl ${isLightTheme ? 'text-white' : headingTextClass}`}
              tabIndex={-1}
              ref={headingRef}
            >
              Mega Draw
            </h1>
            <p className={`m-0 text-sm ${isLightTheme ? 'text-blue-100' : mutedTextClass}`}>
              Mega Draw operational control and year-end winner selection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/admin" className={`${secondaryButtonClass} admin-nav-link`}>
              Back to Admin
            </a>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setIsLightTheme((current) => !current)}
              title="Toggle admin color theme"
            >
              {isLightTheme ? 'Switch to Dark' : 'Switch to Light'}
            </button>
          </div>
        </header>
        <p className="sr-only" aria-live="polite">
          {message}
        </p>
        <div className={`my-4 grid gap-2 rounded-xl p-3 text-sm sm:grid-cols-3 ${surfaceClass}`}>
          <span>
            <strong>State:</strong> {uiState.replaceAll('_', ' ')}
          </span>
          <span>
            <strong>Year:</strong>{' '}
            {preflight?.executionYear ?? lifecycle?.executionYear ?? 'Preparing'}
          </span>
          <span>
            <strong>Eligibility:</strong>{' '}
            {preflight ? `${preflight.candidateCount} candidates` : 'Not prepared'}
          </span>
        </div>
        {uiState === 'LOADING' ? <p role="status">Loading Mega Draw data...</p> : null}
        {uiState === 'ERROR' ? (
          <div
            role="alert"
            className={`mega-draw-alert ${isLightTheme ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-rose-300/50 bg-rose-950/50 text-rose-200'}`}
          >
            <p>{message}</p>
            <button type="button" className={secondaryButtonClass} onClick={() => void load()}>
              Retry load
            </button>
          </div>
        ) : null}
        {!isLocked && uiState !== 'LOADING' ? (
          <form onSubmit={saveConfiguration} className="mt-4 grid gap-3">
            <div className={`mega-prize-configuration__header ${sectionBorderClass}`}>
              <h2
                className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}
              >
                Mega prizes
              </h2>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={prizeNames.length === 10}
                onClick={() => setPrizeNames((current) => [...current, ''])}
              >
                Add prize
              </button>
            </div>
            {prizeNames.map((name, index) => (
              <div key={index} className="mega-prize-row">
                <span className="mega-prize-row__ordinal" aria-label={`Prize ${index + 1}`}>
                  {index + 1}
                </span>
                <div>
                  <label className="sr-only" htmlFor={`mega-prize-${index}`}>
                    Mega prize {index + 1}
                  </label>
                  <input
                    id={`mega-prize-${index}`}
                    className={`${inputClass} w-full`}
                    value={name}
                    maxLength={100}
                    onBlur={validatePrizes}
                    onChange={(event) => replacePrize(index, event.target.value)}
                  />
                  {fieldErrors[index] ? (
                    <p
                      className={`mt-1 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}
                    >
                      {fieldErrors[index]}
                    </p>
                  ) : null}
                </div>
                <div className="mega-prize-row__actions">
                  <button
                    type="button"
                    aria-label={`Move prize ${index + 1} up`}
                    title={`Move prize ${index + 1} up`}
                    className={`${secondaryButtonClass} min-h-8 min-w-8 px-2 text-base leading-none`}
                    disabled={index === 0}
                    onClick={() => movePrize(index, -1)}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    aria-label={`Move prize ${index + 1} down`}
                    title={`Move prize ${index + 1} down`}
                    className={`${secondaryButtonClass} min-h-8 min-w-8 px-2 text-base leading-none`}
                    disabled={index === prizeNames.length - 1}
                    onClick={() => movePrize(index, 1)}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove prize ${index + 1}`}
                    title={`Remove prize ${index + 1}`}
                    className={`${dangerButtonClass} min-h-8 min-w-8 px-2 text-base leading-none`}
                    disabled={prizeNames.length === 1}
                    onClick={() =>
                      setPrizeNames((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
            <div className="mega-prize-configuration__actions">
              <button type="submit" className={primaryButtonClass}>
                <Save aria-hidden="true" size={16} strokeWidth={2} />
                Save configuration
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => void prepare()}>
                <ClipboardCheck aria-hidden="true" size={16} strokeWidth={2} />
                Prepare draw
              </button>
            </div>
          </form>
        ) : null}
        {preflight && !isLocked ? (
          <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
            <h2
              className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}
            >
              Preflight summary
            </h2>
            <p className="mb-0 mt-3 text-sm">
              Campaign {preflight.campaign.id}: {preflight.campaign.fromDate} to{' '}
              {preflight.campaign.toDate} ({preflight.campaign.timezone})
            </p>
            <p className="mb-0 mt-2 text-sm">
              {preflight.candidateCount} eligible candidates for {preflight.prizes.length} prizes.
              One candidate identity is removed after it wins.
            </p>
            <p className="mb-0 mt-2 text-sm">Ready until {formatKolkata(preflight.expiresAt)}.</p>
            {blocked ? (
              <p
                role="alert"
                className={`mb-0 mt-2 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}
              >
                There are not enough eligible participants to run this draw.
              </p>
            ) : (
              <button
                type="button"
                className={`mt-3 ${primaryButtonClass}`}
                onClick={() => openDialog('RUN')}
              >
                Draw next winner
              </button>
            )}
          </section>
        ) : null}
        {uiState === 'PREFLIGHT_STALE' ? (
          <button
            type="button"
            className={`mt-3 ${secondaryButtonClass}`}
            onClick={() => void prepare()}
          >
            Refresh preflight
          </button>
        ) : null}
        {uiState === 'RUNNING' || uiState === 'RESETTING' ? (
          <section
            role="status"
            className={`mt-4 rounded-xl border p-3 ${isLightTheme ? 'border-sky-300 bg-sky-50' : 'border-sky-300/45 bg-sky-950/20'}`}
          >
            <strong>{uiState === 'RUNNING' ? 'Mega Draw running' : 'Mega Draw resetting'}</strong>
            <ol className="mt-2 list-decimal pl-5">
              <li>Validating snapshot</li>
              <li>Finalizing result</li>
              <li>Loading winners</li>
            </ol>
          </section>
        ) : null}
        {lifecycle ? (
          <Results
            lifecycle={lifecycle}
            onDrawNext={() => openDialog('RUN')}
            onReset={() => openDialog('RESET')}
            isLightTheme={isLightTheme}
          />
        ) : null}
        {dialog ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mega-dialog-title"
            className="mega-draw-dialog-overlay fixed inset-0 z-50 grid bg-black/50 p-3 sm:p-4"
          >
            <form onSubmit={submit} className={`mega-draw-dialog ${surfaceClass}`}>
              <div className="mega-draw-dialog__header">
                <span className="mega-draw-dialog__eyebrow">Confirmation required</span>
                <h2
                  id="mega-dialog-title"
                  tabIndex={-1}
                  className={`m-0 text-lg font-semibold ${headingTextClass}`}
                >
                  {dialog === 'RUN'
                    ? `Draw next Mega prize for ${lifecycle?.executionYear ?? preflight?.executionYear}?`
                    : `Reset Mega Draw ${lifecycle?.executionYear}?`}
                </h2>
                <p className={`m-0 text-sm ${mutedTextClass}`}>
                  {dialog === 'RUN'
                    ? `The backend will record the next winner for ${lifecycle?.remainingPrizes[0]?.name ?? preflight?.prizes[0]?.name}.`
                    : 'This clears Mega Draw-only configuration, preflight, lifecycle, and result data for a new editable setup. Main draw data is unchanged.'}
                </p>
              </div>
              <label className="mega-draw-dialog__acknowledgement">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I understand this is an irreversible operational action.
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Type <strong>{expectedConfirmation}</strong>
                <input
                  className={inputClass}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <p className={`mega-draw-dialog__hint ${mutedTextClass}`}>
                {canSubmit
                  ? 'Confirmation complete.'
                  : 'Acknowledge and enter the exact confirmation to continue.'}
              </p>
              <div className="mega-draw-dialog__actions">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={dangerButtonClass}
                  aria-label={
                    dialog === 'RUN' ? 'Confirm draw next winner' : 'Confirm reset Mega Draw'
                  }
                  title={dialog === 'RUN' ? 'Confirm draw next winner' : 'Confirm reset Mega Draw'}
                >
                  {dialog === 'RUN' ? 'Draw next winner' : 'Reset Mega Draw'}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
    </main>
  );
};

const Results = ({
  lifecycle,
  onDrawNext,
  onReset,
  isLightTheme,
}: {
  lifecycle: MegaDrawLifecycle;
  onDrawNext: () => void;
  onReset: () => void;
  isLightTheme: boolean;
}) => {
  const sectionBorderClass = isLightTheme ? 'border-slate-300/70' : 'border-amber-300/30';
  const resultCardClass = isLightTheme
    ? 'border-slate-300/70 bg-white shadow-sm'
    : 'border-amber-300/30 bg-[#11153b] shadow-sm';
  const dangerButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white'
    : 'min-h-10 rounded-lg border border-red-400/70 bg-red-950/40 px-4 text-sm font-semibold text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933]';
  return (
    <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
      <h2 className="m-0 text-base font-semibold uppercase tracking-[0.04em]" tabIndex={-1}>
        {lifecycle.status === 'COMPLETED' ? 'Mega Draw completed' : 'Mega Draw in progress'}
      </h2>
      <p className="mb-0 mt-2 text-sm">
        Configuration is locked after the first winner. Reset Mega Draw to make configuration
        editable again.
      </p>
      {lifecycle.selectedRows.length ? (
        <WinnerRows lifecycle={lifecycle} resultCardClass={resultCardClass} />
      ) : null}
      <PrizeWheel
        prizes={lifecycle.prizes ?? lifecycle.remainingPrizes}
        selectedPrize={lifecycle.selectedRows.at(-1)?.prize}
      />
      <p className="mt-3 text-sm">
        {lifecycle.remainingPrizes.length} prizes remain. Reference: {lifecycle.reference}
        {lifecycle.completedAt ? ` Completed ${formatKolkata(lifecycle.completedAt)}.` : ''}
      </p>
      {lifecycle.status !== 'COMPLETED' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={
              isLightTheme
                ? 'min-h-10 rounded-lg border border-[#1557c0] bg-[#1557c0] px-4 text-sm font-semibold text-white'
                : 'min-h-10 rounded-lg border border-amber-200 bg-amber-100 px-4 text-sm font-semibold text-[#1f1030]'
            }
            onClick={onDrawNext}
          >
            Draw next winner
          </button>
          <button
            type="button"
            className={dangerButtonClass}
            onClick={onReset}
            title="Reset this Mega Draw to a new editable setup"
          >
            <RotateCcw aria-hidden="true" size={16} strokeWidth={2} />
            Reset Mega Draw
          </button>
        </div>
      ) : null}
      {lifecycle.status === 'COMPLETED' ? (
        <div className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
          <button
            type="button"
            className={dangerButtonClass}
            onClick={onReset}
            title="Reset this Mega Draw to a new editable setup"
          >
            <RotateCcw aria-hidden="true" size={16} strokeWidth={2} />
            Reset Mega Draw
          </button>
        </div>
      ) : null}
    </section>
  );
};

const WinnerRows = ({
  lifecycle,
  resultCardClass,
}: {
  lifecycle: MegaDrawLifecycle;
  resultCardClass: string;
}) => (
  <ol className="mt-3 grid list-none gap-2 p-0">
    {lifecycle.selectedRows.map((winner) => (
      <li
        key={winner.prize.position}
        className={`mega-result-row rounded-lg border p-3 ${resultCardClass}`}
      >
        <strong>
          {winner.prize.position}. {winner.prize.name}
        </strong>
        <div className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
          <span>
            {winner.candidate.customerName} ({winner.candidate.maskedPhone})
          </span>
          <span>Bill: {winner.candidate.billNumber}</span>
          <span>Source claim: {winner.candidate.sourceClaimId}</span>
          {winner.sourceClaimStatus === 'SOURCE_CLAIM_ARCHIVED' ? (
            <span>Source claim archived</span>
          ) : null}
        </div>
      </li>
    ))}
  </ol>
);

const PrizeWheel = ({
  prizes,
  selectedPrize,
}: {
  prizes: { position: number; name: string }[];
  selectedPrize?: { position: number; name: string };
}) => (
  <section
    className="mega-prize-wheel mt-4"
    aria-label="Backend-provided prize wheel"
    data-spoke-count={prizes.length}
    data-selected-prize={selectedPrize?.name ?? ''}
  >
    <p className="m-0 text-sm font-semibold">Prize presentation</p>
    <div
      className="mega-prize-wheel__disc"
      data-spoke-count={prizes.length}
      data-selected-prize={selectedPrize?.name ?? ''}
    >
      {prizes.map((prize, index) => (
        <span
          key={prize.position}
          className="mega-prize-wheel__spoke"
          style={{ '--spoke-angle': `${(360 / prizes.length) * index}deg` } as React.CSSProperties}
        >
          {prize.name}
        </span>
      ))}
    </div>
    {selectedPrize ? (
      <p className="mb-0 mt-2 text-sm" role="status">
        Recorded winner: {selectedPrize.name}
      </p>
    ) : null}
  </section>
);
