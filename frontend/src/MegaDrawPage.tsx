import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck,
  HelpCircle,
  Menu,
  Maximize2,
  Minimize2,
  Moon,
  RotateCcw,
  Save,
  Sun,
  X,
} from 'lucide-react';

import type {
  MegaDrawHistory,
  MegaDrawLifecycle,
  MegaDrawPreflight,
  MegaDrawSelectedRow,
} from './types';
import {
  closeMegaDraw,
  drawNextMegaPrize,
  getMegaDraw,
  getMegaDrawStatus,
  MegaDrawApiError,
  prepareMegaDraw,
  reopenMegaDraw,
  resetMegaDraw,
  saveMegaDrawConfiguration,
} from './services/mega-draw-api';
import './admin.tailwind.css';

type Dialog = 'RUN' | 'RESET' | 'CLOSE' | null;
type UiState =
  | 'LOADING'
  | 'SETUP'
  | 'PREFLIGHT_READY'
  | 'PREFLIGHT_STALE'
  | 'RUNNING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CLOSED'
  | 'RESETTING'
  | 'CLOSING'
  | 'ERROR';

const createKey = (): string => crypto.randomUUID();
const formatKolkata = (timestamp: string): string =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(timestamp));

export const MegaDrawPage = () => {
  const [isLightTheme, setIsLightTheme] = useState(
    () =>
      typeof window === 'undefined' ||
      window.localStorage.getItem('dutta-draw-admin-theme') !== 'dark',
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [uiState, setUiState] = useState<UiState>('LOADING');
  const [prizeNames, setPrizeNames] = useState<string[]>(['']);
  const [preflight, setPreflight] = useState<MegaDrawPreflight | null>(null);
  const [lifecycle, setLifecycle] = useState<MegaDrawLifecycle | null>(null);
  const [history, setHistory] = useState<MegaDrawHistory[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const [newWinner, setNewWinner] = useState<MegaDrawSelectedRow | null>(null);
  const [heldPrize, setHeldPrize] = useState<{ position: number; name: string } | null>(null);
  const [isDialogFullscreen, setIsDialogFullscreen] = useState(false);
  const [showFinalWinners, setShowFinalWinners] = useState(false);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const load = async (successMessage = 'Mega Draw configuration loaded.') => {
    setUiState('LOADING');
    try {
      const response = await getMegaDraw();
      setPrizeNames(
        response.configuration.length ? response.configuration.map((prize) => prize.name) : [''],
      );
      setLifecycle(response.lifecycle ?? null);
      setHistory(response.history ?? []);
      const status = response.lifecycle?.status;
      setUiState(
        status === 'CLOSED'
          ? 'CLOSED'
          : status === 'COMPLETED'
            ? 'COMPLETED'
            : status === 'IN_PROGRESS'
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
    if (!newWinner || dialog === 'RUN') return;
    const timer = window.setTimeout(() => resultHeadingRef.current?.focus(), 280);
    return () => window.clearTimeout(timer);
  }, [dialog, newWinner]);
  useEffect(() => {
    if (!heldPrize) return;
    const timer = window.setTimeout(() => setHeldPrize(null), 8500);
    return () => window.clearTimeout(timer);
  }, [heldPrize]);
  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);
  useEffect(() => {
    if (dialog !== 'RUN' || lifecycle?.status !== 'COMPLETED') {
      setShowFinalWinners(false);
      return;
    }
    if (!newWinner) {
      setShowFinalWinners(true);
      return;
    }
    const timer = window.setTimeout(() => setShowFinalWinners(true), 8500);
    return () => window.clearTimeout(timer);
  }, [dialog, lifecycle?.status, newWinner]);

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
      setMessage('Mega prize configuration saved successfully. Prepare a new draw snapshot.');
      setToastMessage('Mega prize configuration saved successfully.');
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
      setMessage('Preflight is ready. Open the preparation ceremony to continue.');
    } catch (error) {
      setUiState(
        error instanceof MegaDrawApiError && error.code === 'PREFLIGHT_STALE'
          ? 'PREFLIGHT_STALE'
          : 'ERROR',
      );
      setMessage(error instanceof Error ? error.message : 'Unable to prepare Mega Draw.');
    }
  };

  const openDialog = (next: Exclude<Dialog, null>, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    setDialog(next);
    setAcknowledged(false);
    setConfirmation('');
    setNewWinner(null);
    setHeldPrize(null);
    setIsDialogFullscreen(false);
    setShowFinalWinners(false);
  };
  const closeDialog = () => {
    setDialog(null);
    setIsDialogFullscreen(false);
    setShowFinalWinners(false);
    openerRef.current?.focus();
  };
  const expectedConfirmation =
    dialog === 'RUN'
      ? `DRAW NEXT MEGA PRIZE ${lifecycle?.executionYear ?? preflight?.executionYear}`
      : dialog === 'CLOSE'
        ? `CLOSE MEGA DRAW ${lifecycle?.executionYear}`
        : `RESET MEGA DRAW ${lifecycle?.executionYear}`;
  const canSubmit =
    dialog === 'RUN' || dialog === 'RESET'
      ? true
      : acknowledged && confirmation === expectedConfirmation;

  const complete = (updatedLifecycle: MegaDrawLifecycle, selectedRow?: MegaDrawSelectedRow) => {
    setLifecycle(updatedLifecycle);
    setAttemptKey(null);
    setUiState(updatedLifecycle.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS');
    if (selectedRow) {
      setHeldPrize(selectedRow.prize);
      setNewWinner(selectedRow);
      setMessage(
        `Winner recorded: ${selectedRow.prize.name}. ${updatedLifecycle.remainingPrizes.length} prizes remain.`,
      );
    }
  };
  const recover = async (key: string): Promise<boolean> => {
    const status = await getMegaDrawStatus(key);
    if (status.execution === 'COMPLETED' && status.lifecycle) {
      complete(status.lifecycle, status.selectedRow);
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
  const drawFromWheel = async () => {
    if (!preflight && !lifecycle) return;
    const key = attemptKey ?? createKey();
    setAttemptKey(key);
    setUiState('RUNNING');
    try {
      if (attemptKey && (await recover(key))) return;
      const response = await drawNextMegaPrize(
        {
          ...(lifecycle ? {} : { preflightReference: preflight!.reference }),
        },
        key,
      );
      complete(response.lifecycle, response.selectedRow);
    } catch (error) {
      if (error instanceof MegaDrawApiError && error.code === 'PREFLIGHT_STALE') {
        setDialog(null);
        setPreflight(null);
        setUiState('PREFLIGHT_STALE');
        setMessage(error.message);
        return;
      }
      try {
        if (await recover(key)) return;
      } catch {
        // Preserve the original failure when status recovery also fails.
      }
      setUiState('ERROR');
      setMessage(
        error instanceof Error ? error.message : 'Mega Draw execution could not be completed.',
      );
    }
  };
  const submitLifecycleAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || dialog === 'RUN') return;
    if (dialog === 'RESET') {
      setUiState('RESETTING');
      try {
        await resetMegaDraw({ acknowledgement: true, confirmation: expectedConfirmation });
        setDialog(null);
        setPreflight(null);
        setLifecycle(null);
        setNewWinner(null);
        setHeldPrize(null);
        setShowFinalWinners(false);
        await load(
          'Mega Draw reset. The preserved prizes are editable and all candidates are eligible again.',
        );
      } catch (error) {
        setUiState('ERROR');
        setMessage(
          error instanceof Error ? error.message : 'Mega Draw reset could not be completed.',
        );
      }
      return;
    }
    setUiState('CLOSING');
    try {
      const response = await closeMegaDraw({ acknowledgement: acknowledged, confirmation });
      setLifecycle(response.lifecycle);
      setDialog(null);
      setUiState('CLOSED');
      setMessage('Mega Draw closed. Results remain available.');
    } catch (error) {
      setUiState('ERROR');
      setMessage(error instanceof Error ? error.message : 'Mega Draw could not be closed.');
    }
  };

  const reopen = async () => {
    try {
      await reopenMegaDraw();
      setLifecycle(null);
      setPreflight(null);
      setNewWinner(null);
      setHeldPrize(null);
      await load('New Mega Draw cycle created. Configure prizes and prepare the draw.');
    } catch (error) {
      setUiState('ERROR');
      setMessage(error instanceof Error ? error.message : 'Mega Draw cycle could not be reopened.');
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
  const isClosed = lifecycle?.status === 'CLOSED';
  const blocked = preflight && preflight.candidateCount < preflight.prizes.length;
  const shellClass = isLightTheme
    ? 'mega-draw-light min-h-screen bg-[#f3f6fa] px-3 py-4 text-slate-800 sm:px-5'
    : 'min-h-screen bg-[#0f1224] px-3 py-4 text-[#ffeecf] sm:px-5';
  const panelClass = isLightTheme
    ? 'mx-auto w-full max-w-6xl rounded-lg border border-[#d9e2ec] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.08)] sm:p-5'
    : 'mx-auto w-full max-w-6xl rounded-lg border border-amber-300/25 bg-[#151933] p-4 shadow-[0_8px_18px_rgba(0,0,0,0.35)] sm:p-5';
  const headingTextClass = isLightTheme ? 'text-slate-900' : 'text-amber-100';
  const mutedTextClass = isLightTheme ? 'text-slate-600' : 'text-amber-100/80';
  const sectionBorderClass = isLightTheme ? 'border-slate-300/70' : 'border-amber-300/30';
  const surfaceClass = isLightTheme
    ? 'border border-solid border-[#d9e2ec] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]'
    : 'border-2 border-solid border-[#d4af37] bg-[#11153b]';
  const inputClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#cfd9e5] bg-[#f5f8fc] px-3 text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563c7]'
    : 'min-h-10 rounded-lg border border-amber-300/35 bg-[#141338] px-3 text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200';
  const primaryButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#1557c0] bg-[#1557c0] px-4 text-sm font-semibold text-white disabled:border-[#9fb9dc] disabled:bg-[#cbd9ec] disabled:text-slate-500'
    : 'min-h-10 rounded-lg border border-amber-200 bg-amber-100 px-4 text-sm font-semibold text-[#1f1030] disabled:border-amber-200/40 disabled:bg-amber-200/40';
  const secondaryButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#cfd9e5] bg-white px-4 text-sm font-semibold text-[#24415f] disabled:border-[#d9e2ec] disabled:bg-[#f1f4f8] disabled:text-slate-500'
    : 'min-h-10 rounded-lg border border-amber-200/70 bg-[#1b1849] px-4 text-sm font-semibold text-amber-100';
  const dangerButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:border-red-200/50 disabled:bg-red-50/60'
    : 'min-h-10 rounded-lg border border-red-400/70 bg-red-950/40 px-4 text-sm font-semibold text-red-200';

  return (
    <main className={shellClass} aria-label="Mega Draw operations page">
      <section className={panelClass}>
        <header
          className={`relative flex flex-wrap items-start justify-between gap-3 rounded-lg px-4 py-3 ${isLightTheme ? 'bg-[#1557c0] text-white' : ''}`}
        >
          <div className="grid gap-1">
            <p
              className={`m-0 text-xs font-bold uppercase tracking-[0.16em] ${isLightTheme ? 'text-blue-100' : 'text-amber-300'}`}
            >
              Dutta Brothers
            </p>
            <h1
              className={`m-0 text-2xl font-semibold uppercase tracking-[0.04em] sm:text-3xl ${isLightTheme ? 'text-white' : headingTextClass}`}
            >
              Mega Draw
            </h1>
            <p className={`m-0 text-sm ${isLightTheme ? 'text-blue-100' : mutedTextClass}`}>
              Year-end winner selection
            </p>
          </div>
          <div className="admin-desktop-actions flex flex-wrap items-center gap-2">
            <a
              href="/admin"
              className={`${secondaryButtonClass} admin-nav-link`}
              aria-label="Back to Admin"
            >
              Back to Admin
            </a>
            <a
              href="/admin/help"
              className="admin-help-link"
              aria-label="Open admin user guide"
              title="Open admin user guide"
            >
              <HelpCircle aria-hidden="true" size={18} />
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
          <button
            type="button"
            className="admin-mobile-menu-button"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
            aria-label={isMobileMenuOpen ? 'Close Mega Draw menu' : 'Open Mega Draw menu'}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mega-draw-mobile-menu"
          >
            {isMobileMenuOpen ? (
              <X aria-hidden="true" size={20} />
            ) : (
              <Menu aria-hidden="true" size={20} />
            )}
          </button>
          {isMobileMenuOpen ? (
            <nav
              id="mega-draw-mobile-menu"
              className="admin-mobile-menu"
              aria-label="Mega Draw actions"
            >
              <a href="/admin" className="admin-mobile-menu-link">
                Back to Admin
              </a>
              <a href="/admin/help" className="admin-mobile-menu-link">
                Help
              </a>
              <button type="button" onClick={() => setIsLightTheme((current) => !current)}>
                {isLightTheme ? 'Switch to Dark' : 'Switch to Light'}
              </button>
            </nav>
          ) : null}
        </header>
        <p className="sr-only" aria-live="polite">
          {message}
        </p>
        <div className={`my-4 grid gap-2 rounded-lg p-3 text-sm sm:grid-cols-3 ${surfaceClass}`}>
          <span>
            <strong>State:</strong> {isClosed ? 'CLOSED' : uiState.replaceAll('_', ' ')}
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
        {toastMessage ? (
          <div
            className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${isLightTheme ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-emerald-300/45 bg-emerald-950/95 text-emerald-100'}`}
            role="status"
            aria-live="polite"
          >
            {toastMessage}
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
                    <p className="mt-1 text-sm text-rose-700">{fieldErrors[index]}</p>
                  ) : null}
                </div>
                <div className="mega-prize-row__actions">
                  <button
                    type="button"
                    aria-label={`Move prize ${index + 1} up`}
                    title={`Move prize ${index + 1} up`}
                    className={`${secondaryButtonClass} min-h-8 min-w-8 px-2`}
                    disabled={index === 0}
                    onClick={() => movePrize(index, -1)}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    aria-label={`Move prize ${index + 1} down`}
                    title={`Move prize ${index + 1} down`}
                    className={`${secondaryButtonClass} min-h-8 min-w-8 px-2`}
                    disabled={index === prizeNames.length - 1}
                    onClick={() => movePrize(index, 1)}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove prize ${index + 1}`}
                    title={`Remove prize ${index + 1}`}
                    className={`${dangerButtonClass} min-h-8 min-w-8 px-2`}
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
                <Save aria-hidden="true" size={16} />
                Save configuration
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => void prepare()}>
                <ClipboardCheck aria-hidden="true" size={16} />
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
              <p role="alert" className="mb-0 mt-2 text-sm text-rose-700">
                There are not enough eligible participants to run this draw.
              </p>
            ) : (
              <button
                type="button"
                className={`mt-3 ${primaryButtonClass}`}
                onClick={(event) => openDialog('RUN', event.currentTarget)}
              >
                Prepare draw
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
        {uiState === 'RUNNING' || uiState === 'RESETTING' || uiState === 'CLOSING' ? (
          <section
            role="status"
            className={`mt-4 rounded-lg border p-3 ${isLightTheme ? 'border-sky-300 bg-sky-50' : 'border-sky-300/45 bg-sky-950/20'}`}
          >
            <strong>
              {uiState === 'RUNNING'
                ? 'Mega Draw running'
                : uiState === 'CLOSING'
                  ? 'Mega Draw closing'
                  : 'Mega Draw resetting'}
            </strong>
            <ol className="mt-2 list-decimal pl-5">
              <li>Validating snapshot</li>
              <li>Selecting next prize</li>
              <li>Loading winner</li>
            </ol>
          </section>
        ) : null}
        {lifecycle ? (
          <Results
            lifecycle={lifecycle}
            newWinner={newWinner}
            resultHeadingRef={resultHeadingRef}
            onDrawNext={(event) => openDialog('RUN', event.currentTarget)}
            onReset={(event) => openDialog('RESET', event.currentTarget)}
            onClose={(event) => openDialog('CLOSE', event.currentTarget)}
            isLightTheme={isLightTheme}
          />
        ) : null}
        {isClosed ? (
          <button
            type="button"
            className={`mt-4 ${primaryButtonClass}`}
            onClick={() => void reopen()}
          >
            Reopen/New Cycle
          </button>
        ) : null}
        {history.some((cycle) => cycle.reference !== lifecycle?.reference) ? (
          <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
            <h2
              className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}
            >
              Closed Mega Draw cycles
            </h2>
            <div className="mt-3 grid gap-2">
              {history
                .filter((cycle) => cycle.reference !== lifecycle?.reference)
                .map((cycle) => (
                  <details
                    key={cycle.reference}
                    className={`rounded-lg border p-3 ${surfaceClass}`}
                  >
                    <summary className={`cursor-pointer font-semibold ${headingTextClass}`}>
                      Cycle {cycle.cycleNumber} - closed{' '}
                      {cycle.closedAt ? formatKolkata(cycle.closedAt) : 'time unavailable'}
                    </summary>
                    <div className="mt-3 grid gap-2 text-sm">
                      {cycle.selectedRows.map((row) => (
                        <p key={`${cycle.reference}-${row.prize.position}`} className="m-0">
                          {row.prize.name}: {row.candidate.customerName} (
                          {row.candidate.maskedPhone})
                        </p>
                      ))}
                    </div>
                  </details>
                ))}
            </div>
          </section>
        ) : null}
        {dialog ? (
          <DialogView
            dialog={dialog}
            lifecycle={lifecycle}
            preflight={preflight}
            heldPrize={heldPrize}
            acknowledged={acknowledged}
            confirmation={confirmation}
            expectedConfirmation={expectedConfirmation}
            canSubmit={canSubmit}
            isBusy={uiState === 'RUNNING' || uiState === 'RESETTING' || uiState === 'CLOSING'}
            newWinner={newWinner}
            showFinalWinners={showFinalWinners}
            isFullscreen={isDialogFullscreen}
            inputClass={inputClass}
            dangerButtonClass={dangerButtonClass}
            onAcknowledge={setAcknowledged}
            onConfirmation={setConfirmation}
            onClose={closeDialog}
            onSubmit={submitLifecycleAction}
            onToggleFullscreen={() => setIsDialogFullscreen((current) => !current)}
            onWheelClick={() => void drawFromWheel()}
          />
        ) : null}
      </section>
    </main>
  );
};

const Results = ({
  lifecycle,
  newWinner,
  resultHeadingRef,
  onDrawNext,
  onReset,
  onClose,
  isLightTheme,
}: {
  lifecycle: MegaDrawLifecycle;
  newWinner: MegaDrawSelectedRow | null;
  resultHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  onDrawNext: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onReset: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onClose: (event: React.MouseEvent<HTMLButtonElement>) => void;
  isLightTheme: boolean;
}) => {
  const isClosed = lifecycle.status === 'CLOSED';
  const isCompleted = lifecycle.status === 'COMPLETED';
  const border = isLightTheme ? 'border-slate-300/70' : 'border-amber-300/30';
  const primary = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#1557c0] bg-[#1557c0] px-4 text-sm font-semibold text-white'
    : 'min-h-10 rounded-lg border border-amber-200 bg-amber-100 px-4 text-sm font-semibold text-[#1f1030]';
  const danger =
    'min-h-10 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700';
  return (
    <section className={`mt-4 border-t pt-4 ${border}`}>
      <h2
        ref={resultHeadingRef}
        tabIndex={-1}
        className="m-0 text-base font-semibold uppercase tracking-[0.04em]"
      >
        {isClosed
          ? 'Mega Draw closed'
          : isCompleted
            ? 'Mega Draw completed'
            : 'Mega Draw in progress'}
      </h2>
      {!isClosed ? (
        <p className="mb-0 mt-2 text-sm">
          Configuration is locked after the first winner. Reset Mega Draw to make configuration
          editable again.
        </p>
      ) : (
        <p className="mb-0 mt-2 text-sm">
          This terminal lifecycle is read-only. Results remain available.
        </p>
      )}
      <WinnerRows lifecycle={lifecycle} newWinner={newWinner} isLightTheme={isLightTheme} />
      <p className="mt-3 text-sm">
        {lifecycle.remainingPrizes.length} prizes remain. Cycle {lifecycle.cycleNumber}. Reference:{' '}
        {lifecycle.reference}
        {lifecycle.completedAt ? ` Completed ${formatKolkata(lifecycle.completedAt)}.` : ''}
        {lifecycle.closedAt ? ` Closed ${formatKolkata(lifecycle.closedAt)}.` : ''}
      </p>
      {!isClosed ? (
        <div className={`mt-4 flex flex-wrap gap-2 border-t pt-4 ${border}`}>
          {!isCompleted ? (
            <button type="button" className={primary} onClick={onDrawNext}>
              Prepare next prize
            </button>
          ) : (
            <button type="button" className={danger} onClick={onClose}>
              Close Mega Draw
            </button>
          )}
          <button type="button" className={danger} onClick={onReset}>
            <RotateCcw aria-hidden="true" size={16} />
            Reset Mega Draw
          </button>
        </div>
      ) : null}
    </section>
  );
};

const WinnerRows = ({
  lifecycle,
  newWinner,
  isLightTheme,
}: {
  lifecycle: MegaDrawLifecycle;
  newWinner: MegaDrawSelectedRow | null;
  isLightTheme: boolean;
}) => (
  <ol className="mt-3 grid list-none gap-2 p-0">
    {lifecycle.selectedRows.map((winner) => (
      <li
        key={`${winner.prize.position}-${winner.candidate.sourceClaimId}`}
        className={`mega-result-row rounded-lg border p-3 ${isLightTheme ? 'border-slate-300/70 bg-white text-slate-900' : 'border-amber-300/30 bg-[#151933] text-amber-100'} ${newWinner?.prize.position === winner.prize.position ? 'mega-result-row--new' : ''}`}
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

const DialogView = ({
  dialog,
  lifecycle,
  preflight,
  heldPrize,
  acknowledged,
  confirmation,
  expectedConfirmation,
  canSubmit,
  isBusy,
  newWinner,
  showFinalWinners,
  isFullscreen,
  inputClass,
  dangerButtonClass,
  onAcknowledge,
  onConfirmation,
  onClose,
  onSubmit,
  onToggleFullscreen,
  onWheelClick,
}: {
  dialog: Exclude<Dialog, null>;
  lifecycle: MegaDrawLifecycle | null;
  preflight: MegaDrawPreflight | null;
  heldPrize: { position: number; name: string } | null;
  acknowledged: boolean;
  confirmation: string;
  expectedConfirmation: string;
  canSubmit: boolean;
  isBusy: boolean;
  newWinner: MegaDrawSelectedRow | null;
  showFinalWinners: boolean;
  isFullscreen: boolean;
  inputClass: string;
  dangerButtonClass: string;
  onAcknowledge: (value: boolean) => void;
  onConfirmation: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onToggleFullscreen: () => void;
  onWheelClick: () => void;
}) => {
  const nextPrize = lifecycle ? lifecycle.remainingPrizes[0] : preflight?.prizes.at(-1);
  const wheelPrizes = lifecycle?.remainingPrizes ?? preflight?.prizes ?? [];
  const displayedPrizes =
    heldPrize && !wheelPrizes.some((prize) => prize.position === heldPrize.position)
      ? [heldPrize, ...wheelPrizes]
      : wheelPrizes;
  const isRun = dialog === 'RUN';
  const isReset = dialog === 'RESET';
  const canDraw = Boolean(nextPrize) && !isBusy;
  const title = isRun
    ? nextPrize
      ? `Prepare next Mega prize for ${lifecycle?.executionYear ?? preflight?.executionYear}?`
      : `Mega Draw ${lifecycle?.executionYear ?? preflight?.executionYear} completed`
    : dialog === 'CLOSE'
      ? `Close Mega Draw ${lifecycle?.executionYear}?`
      : `Reset Mega Draw ${lifecycle?.executionYear}?`;
  return (
    <div
      className={`mega-draw-dialog-overlay fixed inset-0 z-50 grid p-3 sm:p-4 ${isRun ? 'mega-draw-dialog-overlay--festive' : 'bg-black/50'}`}
      role="presentation"
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mega-dialog-title"
        className={`mega-draw-dialog ${isRun ? `mega-draw-dialog--festive ${isFullscreen ? 'mega-draw-dialog--fullscreen' : ''}` : 'border border-slate-300 bg-white'}`}
      >
        {isRun ? (
          <button
            type="button"
            className="mega-draw-dialog__fullscreen"
            aria-label={isFullscreen ? 'Exit fullscreen dialog' : 'Open fullscreen dialog'}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            disabled={isBusy}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 aria-hidden="true" size={18} />
            ) : (
              <Maximize2 aria-hidden="true" size={18} />
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="mega-draw-dialog__close"
          aria-label="Close dialog"
          disabled={isBusy}
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
        <div className="mega-draw-dialog__header">
          <span className="mega-draw-dialog__eyebrow">
            {isRun ? 'Ready to draw' : isReset ? 'Confirm reset' : 'Confirmation required'}
          </span>
          <h2 id="mega-dialog-title" tabIndex={-1} className="m-0 text-lg font-semibold">
            {title}
          </h2>
          <p className="m-0 text-sm">
            {isRun
              ? nextPrize
                ? `The wheel will randomly select the next winner for ${nextPrize.name} from the eligible claimant list.`
                : 'All configured Mega prizes have recorded winners.'
              : dialog === 'CLOSE'
                ? 'Closing preserves these visible results and permanently disables every Mega Draw action.'
                : 'Reset keeps the configured prizes but clears the active lifecycle and makes prior candidates eligible again.'}
          </p>
        </div>
        {isRun && nextPrize ? (
          <p className="mega-draw-dialog__hint mega-draw-dialog__hint--run">
            Click the wheel to randomly select the next winner.
          </p>
        ) : null}
        {isRun && showFinalWinners && lifecycle ? (
          <FinalWinners rows={lifecycle.selectedRows} />
        ) : null}
        {isRun && !showFinalWinners ? (
          <FestiveWheel
            prizes={displayedPrizes}
            nextPrize={nextPrize}
            winner={newWinner}
            winnerAnimationKey={
              newWinner ? `${newWinner.prize.position}-${newWinner.candidate.sourceClaimId}` : null
            }
            enabled={canDraw}
            spinning={Boolean(newWinner)}
            onClick={onWheelClick}
          />
        ) : null}
        {isRun || isReset ? null : (
          <>
            <label className="mega-draw-dialog__acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={isBusy}
                onChange={(event) => onAcknowledge(event.target.checked)}
              />
              I understand this is an irreversible operational action.
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Type <strong>{expectedConfirmation}</strong>
              <input
                className={inputClass}
                value={confirmation}
                disabled={isBusy}
                onChange={(event) => onConfirmation(event.target.value)}
              />
            </label>
            <p className="mega-draw-dialog__hint">
              {canSubmit
                ? 'Confirmation complete.'
                : 'Acknowledge and enter the exact confirmation to continue.'}
            </p>
          </>
        )}
        {isReset ? (
          <p className="mega-draw-dialog__hint">
            Confirm reset to clear the active Mega Draw result state and return the preserved prizes
            to editable setup.
          </p>
        ) : null}
        {isRun ? <p aria-hidden="true" className="mega-draw-dialog__run-status" /> : null}
        {isRun ? null : (
          <div className="mega-draw-dialog__actions">
            <button type="submit" className={dangerButtonClass} disabled={!canSubmit || isBusy}>
              {dialog === 'CLOSE' ? 'Close Mega Draw' : 'Reset Mega Draw'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
};

const FinalWinners = ({ rows }: { rows: MegaDrawSelectedRow[] }) => (
  <section className="mega-final-winners" aria-label="Mega Draw final winners">
    <ol>
      {rows.map((winner) => (
        <li key={`${winner.prize.position}-${winner.candidate.sourceClaimId}`}>
          <span className="mega-final-winners__prize">{winner.prize.name}</span>
          <strong>{winner.candidate.customerName}</strong>
          <span className="mega-final-winners__phone">
            {winner.candidate.normalizedPhone ?? winner.candidate.maskedPhone}
          </span>
        </li>
      ))}
    </ol>
  </section>
);

const FestiveWheel = ({
  prizes,
  nextPrize,
  winner,
  winnerAnimationKey,
  enabled,
  spinning,
  onClick,
}: {
  prizes: { position: number; name: string }[];
  nextPrize?: { position: number; name: string };
  winner: MegaDrawSelectedRow | null;
  winnerAnimationKey: string | null;
  enabled: boolean;
  spinning: boolean;
  onClick: () => void;
}) => (
  <section
    className="mega-prize-wheel mega-prize-wheel--festive"
    aria-label="Backend-provided prize wheel"
    data-spoke-count={prizes.length}
    style={{ '--prize-count': prizes.length } as React.CSSProperties}
  >
    <div className="mega-prize-wheel__bulbs" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => (
        <span key={index} style={{ '--bulb-angle': `${index * 22.5}deg` } as React.CSSProperties} />
      ))}
    </div>
    <button
      key={`wheel-${winnerAnimationKey ?? 'ready'}`}
      type="button"
      className={`mega-prize-wheel__disc ${spinning ? 'mega-prize-wheel__disc--spinning' : ''}`}
      disabled={!enabled}
      aria-label={nextPrize ? `Draw next Mega prize: ${nextPrize.name}` : 'Mega Draw completed'}
      onClick={onClick}
    >
      {prizes.map((prize, index) => (
        <span
          key={prize.position}
          className="mega-prize-wheel__spoke"
          style={
            {
              '--spoke-angle': `${(360 / Math.max(prizes.length, 1)) * index}deg`,
            } as React.CSSProperties
          }
        >
          {prize.name.split(/\s+/).map((word, wordIndex) => (
            <span key={`${word}-${wordIndex}`}>{word}</span>
          ))}
        </span>
      ))}
      <span className="mega-prize-wheel__hub">DRAW</span>
    </button>
    {winner ? (
      <div
        key={`winner-${winnerAnimationKey ?? winner.selectedAt}`}
        role="status"
        className="mega-prize-wheel__winner-overlay"
      >
        <span className="mega-prize-wheel__winner-kicker">Winner selected</span>
        <strong className="mega-prize-wheel__winner-name">{winner.candidate.customerName}</strong>
        <span className="mega-prize-wheel__winner-prize">{winner.prize.name}</span>
        <span className="mega-prize-wheel__winner-phone">
          {winner.candidate.normalizedPhone ?? winner.candidate.maskedPhone}
        </span>
      </div>
    ) : null}
  </section>
);
