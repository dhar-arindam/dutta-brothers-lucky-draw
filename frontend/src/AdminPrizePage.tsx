import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react';

import type {
  AdminCampaignResponse,
  AdminClaimItem,
  AdminClaimsListResponse,
  AdminErrorResponse,
  AdminPrize,
  AdminSummaryResponse,
} from './types';
import {
  addAdminPrize,
  clearAdminClaims,
  deleteAdminClaim,
  exportAdminClaimsCsv,
  getAdminCampaign,
  getAdminSummary,
  listAdminClaims,
  listAdminPrizes,
  patchAdminCampaign,
  patchAdminPrize,
  type AdminClaimsQuery,
} from './services/admin-prize-api';
import './admin.tailwind.css';

type AdminPageState =
  | { type: 'READY' }
  | { type: 'ERROR'; message: string };

type BusyAction =
  | 'NONE'
  | 'INITIAL'
  | 'CLAIMS'
  | 'CSV'
  | 'CLAIM_DELETE'
  | 'CLAIMS_CLEAR'
  | 'PRIZE_ADD'
  | 'PRIZE_WEIGHT'
  | 'PRIZE_TOGGLE'
  | 'CAMPAIGN';

interface AddPrizeForm {
  name: string;
  weight: string;
  active: boolean;
}

interface ClaimsFilters {
  search: string;
  prizeId: string;
  from: string;
  to: string;
  pageSize: string;
}

interface CampaignForm {
  fromDate: string;
  toDate: string;
}

interface CampaignFormErrors {
  fromDate?: string;
  toDate?: string;
}

type CampaignTone = 'not-configured' | 'not-started' | 'active' | 'ended';

type ConfirmDialogState =
  | { type: 'DELETE_CLAIM'; claimId: string }
  | { type: 'CLEAR_ALL_CLAIMS' };

const CLEAR_ALL_CONFIRMATION_PHRASE = 'CLEAR ALL CLAIMS';

const defaultAddPrizeForm: AddPrizeForm = {
  name: '',
  weight: '',
  active: true,
};

const defaultFilters: ClaimsFilters = {
  search: '',
  prizeId: '',
  from: '',
  to: '',
  pageSize: '25',
};

const claimsPageSizeOptions = ['25', '50', '75', '100', '125', '150'];

export const AdminPrizePage = () => {
  const [isLightTheme, setIsLightTheme] = useState(true);
  const [state, setState] = useState<AdminPageState>({ type: 'READY' });
  const [busyAction, setBusyAction] = useState<BusyAction>('NONE');
  const [statusMessage, setStatusMessage] = useState('');
  const [liveMessage, setLiveMessage] = useState('');
  const [prizes, setPrizes] = useState<AdminPrize[]>([]);
  const [claims, setClaims] = useState<AdminClaimItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pageTokens, setPageTokens] = useState<string[]>([]);
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null);
  const [campaign, setCampaign] = useState<AdminCampaignResponse['campaign'] | null>(null);
  const [lastCsvExport, setLastCsvExport] = useState('');
  const [copiedClaimId, setCopiedClaimId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [clearAllConfirmationText, setClearAllConfirmationText] = useState('');

  const [filters, setFilters] = useState<ClaimsFilters>(defaultFilters);
  const [addForm, setAddForm] = useState<AddPrizeForm>(defaultAddPrizeForm);
  const [addErrors, setAddErrors] = useState<Partial<Record<'name' | 'weight', string>>>({});
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [campaignForm, setCampaignForm] = useState<CampaignForm>({ fromDate: '', toDate: '' });
  const [campaignErrors, setCampaignErrors] = useState<CampaignFormErrors>({});

  const isBusy = busyAction !== 'NONE';

  const sortedPrizes = useMemo(() => {
    return [...prizes].sort((a, b) => a.id.localeCompare(b.id));
  }, [prizes]);

  const activePrizeCount = useMemo(() => {
    return prizes.filter((prize) => prize.active && prize.weight > 0).length;
  }, [prizes]);

  const lastClaimTimestamp = claims.length > 0 ? claims[0]?.claimTimestamp : null;

  const hasActiveFilters = Boolean(
    filters.search.trim() || filters.prizeId || filters.from.trim() || filters.to.trim(),
  );

  const givenByPrizeId = useMemo(() => {
    return new Map((summary?.prizeDistribution ?? []).map((item) => [item.prizeId, item.givenCount]));
  }, [summary]);

  const filteredPrizeName = useMemo(() => {
    if (!filters.prizeId) {
      return null;
    }

    return prizes.find((prize) => prize.id === filters.prizeId)?.name ?? null;
  }, [filters.prizeId, prizes]);

  const campaignStatus = useMemo(() => {
    if (!campaign || !campaign.fromDate || !campaign.toDate) {
      return {
        label: 'NOT CONFIGURED',
        tone: 'not-configured' as CampaignTone,
        detail: 'Set From Date and To Date to run the draw campaign.',
      };
    }

    const todayInCampaignTimezone = campaignDateInTimezone(new Date(), campaign.timezone);
    if (todayInCampaignTimezone < campaign.fromDate) {
      return {
        label: 'NOT STARTED',
        tone: 'not-started' as CampaignTone,
        detail: 'Campaign has not started yet.',
      };
    }

    if (todayInCampaignTimezone > campaign.toDate) {
      return {
        label: 'ENDED',
        tone: 'ended' as CampaignTone,
        detail: 'Customers can no longer participate.',
      };
    }

    return {
      label: 'ACTIVE',
      tone: 'active' as CampaignTone,
      detail: `${formatDateOnly(campaign.fromDate)} -> ${formatDateOnly(campaign.toDate)}`,
    };
  }, [campaign]);

  const panelLoadingText =
    busyAction === 'INITIAL'
      ? 'Loading admin data...'
      : busyAction === 'CLAIMS'
        ? 'Loading claims...'
        : busyAction === 'CSV'
          ? 'Preparing CSV export...'
          : busyAction === 'CLAIM_DELETE'
            ? 'Deleting claim...'
            : busyAction === 'CLAIMS_CLEAR'
              ? 'Clearing all claims...'
              : busyAction === 'PRIZE_ADD'
                ? 'Adding prize...'
                : busyAction === 'PRIZE_WEIGHT'
                  ? 'Saving weight...'
                  : busyAction === 'PRIZE_TOGGLE'
                    ? 'Updating prize state...'
                    : busyAction === 'CAMPAIGN'
                      ? 'Saving campaign period...'
                      : '';

  const setFeedback = (message: string) => {
    setStatusMessage(message);
    setLiveMessage(message);
  };

  const setErrorState = (message: string) => {
    setState({ type: 'ERROR', message });
    setLiveMessage(message);
  };

  const loadAdminData = async () => {
    setBusyAction('INITIAL');
    setFeedback('Loading admin data...');

    try {
      const [summaryResponse, campaignResponse, prizesResponse, claimsResponse] = await Promise.all([
        getAdminSummary(),
        getAdminCampaign(),
        listAdminPrizes(),
        listAdminClaims({ pageSize: Number(filters.pageSize) || 25 }),
      ]);

      const failure = firstError(summaryResponse, campaignResponse, prizesResponse, claimsResponse);
      if (failure) {
        setErrorState(failure.message);
        return;
      }

      if (!('items' in prizesResponse) || !('items' in claimsResponse) || !('campaign' in campaignResponse)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      setSummary(summaryResponse as AdminSummaryResponse);
      setCampaign((campaignResponse as AdminCampaignResponse).campaign);
      setCampaignForm({
        fromDate: (campaignResponse as AdminCampaignResponse).campaign.fromDate,
        toDate: (campaignResponse as AdminCampaignResponse).campaign.toDate,
      });
      setCampaignErrors({});
      setPrizes((prizesResponse.items ?? []).slice());
      setWeightDrafts(Object.fromEntries(prizesResponse.items.map((item) => [item.id, String(item.weight)])));

      const claimsPayload = claimsResponse as AdminClaimsListResponse;
      setClaims(claimsPayload.items);
      setNextPageToken(claimsPayload.nextPageToken);
      setPageTokens([]);

      setState({ type: 'READY' });
      setFeedback('Admin data loaded.');
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  useEffect(() => {
    void loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadClaims = async (query: AdminClaimsQuery, trackToken = true) => {
    setBusyAction('CLAIMS');
    setFeedback('Loading claims...');

    try {
      const response = await listAdminClaims(query);
      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      if (!('items' in response)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      if (trackToken && query.pageToken) {
        setPageTokens((current) => [...current, query.pageToken as string]);
      }

      setClaims(response.items);
      setNextPageToken(response.nextPageToken);
      setState({ type: 'READY' });
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const buildClaimsQuery = (pageToken?: string, sourceFilters: ClaimsFilters = filters): AdminClaimsQuery => {
    const fromDate = sourceFilters.from.trim();
    const toDate = sourceFilters.to.trim();

    return {
      pageSize: Number(sourceFilters.pageSize) || 25,
      pageToken,
      from: toUtcRangeBoundary(fromDate, 'start'),
      to: toUtcRangeBoundary(toDate, 'end'),
      prizeId: sourceFilters.prizeId || undefined,
      search: sourceFilters.search.trim() || undefined,
    };
  };

  const onApplyFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setPageTokens([]);
    await loadClaims(buildClaimsQuery(), false);
    setFeedback('Filters applied.');
  };

  const onClearFilters = async () => {
    setFilters(defaultFilters);
    setPageTokens([]);
    await loadClaims(buildClaimsQuery(undefined, defaultFilters), false);
    setFeedback('Filters cleared.');
  };

  const onSelectPrizeFilter = async (prizeId: string) => {
    const nextFilters: ClaimsFilters = {
      ...filters,
      prizeId,
    };

    setFilters(nextFilters);
    setPageTokens([]);
    await loadClaims(buildClaimsQuery(undefined, nextFilters), false);
    setFeedback(prizeId ? 'Prize filter applied.' : 'Showing all prize claims.');
  };

  const onPrizeFilterKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    prizeId: string,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    void onSelectPrizeFilter(prizeId);
  };

  const onNextPage = async () => {
    if (!nextPageToken) {
      return;
    }

    await loadClaims(buildClaimsQuery(nextPageToken));
  };

  const onPreviousPage = async () => {
    if (pageTokens.length === 0) {
      return;
    }

    const previousTokens = [...pageTokens];
    previousTokens.pop();
    const previousToken = previousTokens.at(-1);

    setBusyAction('CLAIMS');
    setFeedback('Loading previous claims page...');
    try {
      const response = await listAdminClaims(buildClaimsQuery(previousToken));
      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      if (!('items' in response)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      setClaims(response.items);
      setNextPageToken(response.nextPageToken);
      setPageTokens(previousTokens);
      setState({ type: 'READY' });
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onExportCsv = async () => {
    setBusyAction('CSV');
    setFeedback('Preparing CSV export...');

    try {
      const csvText = await exportAdminClaimsCsv(buildClaimsQuery());
      setLastCsvExport(csvText);

      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'claims.csv';
        link.click();
        URL.revokeObjectURL(url);
      }

      setState({ type: 'READY' });
      setFeedback('CSV export generated.');
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onAddPrize = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const fieldErrors: Partial<Record<'name' | 'weight', string>> = {};
    if (!addForm.name.trim()) {
      fieldErrors.name = 'Prize name is required.';
    }

    const parsedWeight = Number(addForm.weight);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      fieldErrors.weight = 'Weight must be a positive number.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      setAddErrors(fieldErrors);
      setLiveMessage('Please correct the highlighted prize form fields.');
      return;
    }

    setAddErrors({});
    setBusyAction('PRIZE_ADD');
    setFeedback('Adding prize...');

    try {
      const response = await addAdminPrize({
        name: addForm.name.trim(),
        weight: parsedWeight,
        active: addForm.active,
      });

      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      if (!('item' in response)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      setPrizes((current) => [...current, response.item]);
      setWeightDrafts((current) => ({ ...current, [response.item.id]: String(response.item.weight) }));
      setAddForm(defaultAddPrizeForm);
      setState({ type: 'READY' });
      setFeedback('Prize added successfully.');
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onSaveWeight = async (prize: AdminPrize) => {
    const draft = weightDrafts[prize.id] ?? String(prize.weight);
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrorState('Weight must be a positive number.');
      return;
    }

    setBusyAction('PRIZE_WEIGHT');
    setFeedback('Saving weight...');
    try {
      const response = await patchAdminPrize(prize.id, { weight: parsed });
      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      if (!('item' in response)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      setPrizes((current) => current.map((item) => (item.id === prize.id ? response.item : item)));
      setWeightDrafts((current) => ({ ...current, [prize.id]: String(response.item.weight) }));
      setState({ type: 'READY' });
      setFeedback('Weight updated. Weight is relative probability, not a percentage.');
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onToggleActive = async (prize: AdminPrize) => {
    setBusyAction('PRIZE_TOGGLE');
    setFeedback('Updating prize state...');
    try {
      const response = await patchAdminPrize(prize.id, { active: !prize.active });
      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      if (!('item' in response)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      setPrizes((current) => current.map((item) => (item.id === prize.id ? response.item : item)));
      setState({ type: 'READY' });
      setFeedback(
        response.item.active
          ? 'Prize activated for future eligible draws.'
          : 'Prize deactivated. It will be excluded from future draws.',
      );
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onSaveCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: CampaignFormErrors = {};
    const fromDate = campaignForm.fromDate.trim();
    const toDate = campaignForm.toDate.trim();

    if (!fromDate) {
      nextErrors.fromDate = 'From Date is required.';
    }
    if (!toDate) {
      nextErrors.toDate = 'To Date is required.';
    }
    if (!nextErrors.fromDate && !isValidIsoDate(fromDate)) {
      nextErrors.fromDate = 'From Date must be a valid calendar date.';
    }
    if (!nextErrors.toDate && !isValidIsoDate(toDate)) {
      nextErrors.toDate = 'To Date must be a valid calendar date.';
    }
    if (!nextErrors.fromDate && !nextErrors.toDate && fromDate > toDate) {
      nextErrors.toDate = 'To Date must be on or after From Date.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setCampaignErrors(nextErrors);
      setLiveMessage('Please correct the campaign period fields.');
      return;
    }

    setCampaignErrors({});

    setBusyAction('CAMPAIGN');
    setFeedback('Saving campaign period...');

    try {
      const response = await patchAdminCampaign({
        fromDate,
        toDate,
      });

      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      if (!('campaign' in response)) {
        setErrorState('We could not complete the admin request. Please try again.');
        return;
      }

      setCampaign(response.campaign);
      setCampaignForm({ fromDate: response.campaign.fromDate, toDate: response.campaign.toDate });
      setState({ type: 'READY' });
      setFeedback('Campaign period updated successfully.');
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onCopyClaimId = async (claimId: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(claimId);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = claimId;
        textArea.setAttribute('readonly', 'true');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopiedClaimId(claimId);
      setLiveMessage(`Claim ID ${claimId} copied.`);
      window.setTimeout(() => {
        setCopiedClaimId((current) => (current === claimId ? null : current));
      }, 1400);
    } catch {
      setErrorState('Could not copy claim ID. Please try again.');
    }
  };

  const onDeleteClaim = (claimId: string) => {
    setConfirmDialog({ type: 'DELETE_CLAIM', claimId });
  };

  const onConfirmDeleteClaim = async (claimId: string) => {
    setConfirmDialog(null);
    setBusyAction('CLAIM_DELETE');
    setFeedback('Deleting claim...');

    try {
      const response = await deleteAdminClaim(claimId);
      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      await loadAdminData();
      setFeedback(`Claim ${claimId} deleted.`);
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const onClearAllClaims = () => {
    setConfirmDialog({ type: 'CLEAR_ALL_CLAIMS' });
    setClearAllConfirmationText('');
  };

  const onConfirmClearAllClaims = async () => {
    setConfirmDialog(null);
    setBusyAction('CLAIMS_CLEAR');
    setFeedback('Clearing all claims...');

    try {
      const response = await clearAdminClaims();
      if (response.status === 'ERROR') {
        setErrorState(response.message);
        return;
      }

      await loadAdminData();
      setFeedback(`Cleared ${response.deletedCount} claim(s).`);
    } catch {
      setErrorState('We could not complete the admin request. Please try again.');
    } finally {
      setBusyAction('NONE');
    }
  };

  const shellClass = isLightTheme
    ? 'min-h-screen bg-[#efe5d4] px-3 py-4 text-slate-800 sm:px-5'
    : 'min-h-screen bg-[#0f1224] px-3 py-4 text-[#ffeecf] sm:px-5';
  const panelClass = isLightTheme
    ? 'mx-auto w-full max-w-6xl rounded-2xl border border-[#c79f32] bg-[#f7efdf] p-4 shadow-[0_8px_18px_rgba(15,23,42,0.12)] sm:p-5'
    : 'mx-auto w-full max-w-6xl rounded-2xl border border-amber-300/25 bg-[#151933] p-4 shadow-[0_8px_18px_rgba(0,0,0,0.35)] sm:p-5';
  const headingTextClass = isLightTheme ? 'text-slate-900' : 'text-amber-100';
  const mutedTextClass = isLightTheme ? 'text-slate-600' : 'text-amber-100/80';
  const sectionBorderClass = isLightTheme ? 'border-slate-300/70' : 'border-amber-300/30';
  const surfaceClass = isLightTheme
    ? 'bg-[#f3e9d7] border-2 border-solid border-[#c79f32]'
    : 'bg-[#11153b] border-2 border-solid border-[#d4af37]';
  const inputClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-slate-300 bg-[#f9f1e3] px-3 text-slate-800 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b88f20] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7efdf]'
    : 'min-h-10 rounded-lg border border-amber-300/35 bg-[#141338] px-3 text-amber-50 placeholder:text-amber-100/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933]';
  const primaryButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-[#d4af37] bg-[#d4af37] px-4 text-sm font-semibold text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b88f20] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7efdf] disabled:border-[#d4af37]/40 disabled:bg-[#d4af37]/40 disabled:text-slate-700/70'
    : 'min-h-10 rounded-lg border border-amber-200 bg-amber-100 px-4 text-sm font-semibold text-[#1f1030] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-amber-200/40 disabled:bg-amber-200/40 disabled:text-[#1f1030]/60';
  const secondaryButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-slate-300 bg-[#f8efdf] px-4 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b88f20] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7efdf] disabled:border-slate-300/50 disabled:bg-[#ece1cc] disabled:text-slate-500'
    : 'min-h-10 rounded-lg border border-amber-200/70 bg-[#1b1849] px-4 text-sm font-semibold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-amber-200/30 disabled:bg-[#1b1849]/60 disabled:text-amber-100/60';
  const smallSecondaryButtonClass = isLightTheme
    ? 'min-h-8 rounded-lg border border-slate-300 bg-[#f8efdf] px-3 text-xs font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b88f20] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7efdf] disabled:border-slate-300/50 disabled:bg-[#ece1cc] disabled:text-slate-500'
    : 'min-h-8 rounded-lg border border-amber-200/70 bg-[#1b1849] px-3 text-xs font-semibold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-amber-200/30 disabled:bg-[#1b1849]/60 disabled:text-amber-100/60';
  const dangerButtonClass = isLightTheme
    ? 'min-h-10 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7efdf] disabled:border-red-200/50 disabled:bg-red-50/60 disabled:text-red-700/50'
    : 'min-h-10 rounded-lg border border-red-400/70 bg-red-950/40 px-4 text-sm font-semibold text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-red-400/30 disabled:bg-red-950/20 disabled:text-red-200/50';
  const smallDangerButtonClass = isLightTheme
    ? 'min-h-8 rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-semibold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7efdf] disabled:border-red-200/50 disabled:bg-red-50/60 disabled:text-red-700/50'
    : 'min-h-8 rounded-lg border border-red-400/70 bg-red-950/40 px-3 text-xs font-semibold text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151933] disabled:border-red-400/30 disabled:bg-red-950/20 disabled:text-red-200/50';
  const isCampaignActive = campaignStatus.tone === 'active';
  const isCampaignNotStarted = campaignStatus.tone === 'not-started';
  const campaignToneClass = isLightTheme
    ? isCampaignActive
      ? 'border-solid border-emerald-300 bg-emerald-50'
      : isCampaignNotStarted
        ? 'border-solid border-sky-300 bg-sky-50'
      : 'border-solid border-amber-300 bg-amber-50'
    : isCampaignActive
      ? 'border-solid border-emerald-300/45 bg-emerald-950/20'
      : isCampaignNotStarted
        ? 'border-solid border-sky-300/45 bg-sky-950/20'
      : 'border-solid border-amber-300/45 bg-amber-950/20';
  const campaignBadgeClass = isLightTheme
    ? isCampaignActive
      ? 'border-solid border-emerald-300 bg-emerald-100 text-emerald-800'
      : isCampaignNotStarted
        ? 'border-solid border-sky-300 bg-sky-100 text-sky-800'
      : 'border-solid border-amber-300 bg-amber-100 text-amber-800'
    : isCampaignActive
      ? 'border-solid border-emerald-300/55 bg-emerald-900/45 text-emerald-100'
      : isCampaignNotStarted
        ? 'border-solid border-sky-300/55 bg-sky-900/45 text-sky-100'
      : 'border-solid border-amber-300/55 bg-amber-900/45 text-amber-100';
  const campaignDetailClass = isLightTheme
    ? 'text-slate-700'
    : isCampaignActive
      ? 'text-emerald-100/95'
      : isCampaignNotStarted
        ? 'text-sky-100/95'
        : 'text-amber-100/95';
  const csvPanelClass = isLightTheme
    ? 'mt-3 overflow-hidden rounded-xl border border-[#c79f32] bg-[#f5ecdb]'
    : 'mt-3 overflow-hidden rounded-xl border border-amber-300/35 bg-[#101437]';
  const csvPanelSummaryClass = isLightTheme
    ? 'px-3 py-2 text-sm font-semibold text-slate-800 bg-[#ecdfc7] border-b border-[#c79f32]'
    : 'px-3 py-2 text-sm font-semibold text-amber-100 bg-[#1a1f47] border-b border-amber-300/35';
  const csvPanelPreviewClass = isLightTheme
    ? 'm-0 max-h-48 overflow-auto p-3 text-xs bg-[#f8f1e4] text-slate-700'
    : 'm-0 max-h-48 overflow-auto p-3 text-xs bg-[#0f1331] text-amber-100';

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStatusMessage('');
    }, 2600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [statusMessage]);

  return (
    <main className={shellClass} aria-label="Admin operations page">
      <section className={panelClass}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className={`m-0 text-xs font-bold uppercase tracking-[0.16em] ${isLightTheme ? 'text-slate-500' : 'text-amber-300'}`}>Dutta Brothers</p>
            <h1 className={`m-0 text-2xl font-semibold uppercase tracking-[0.04em] sm:text-3xl ${headingTextClass}`}>Lucky Draw Admin</h1>
            <p className={`m-0 text-sm ${mutedTextClass}`}>Operational view for campaign control, prize status, and claims reporting.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => void loadAdminData()}
              disabled={isBusy}
            >
              {busyAction === 'INITIAL' ? 'Refreshing...' : 'Refresh'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setIsLightTheme((current) => !current)}>
              {isLightTheme ? 'Switch to Dark' : 'Switch to Light'}
            </button>
          </div>
        </header>

        <p className="sr-only" aria-live="polite">
          {liveMessage || panelLoadingText}
        </p>

        {state.type === 'ERROR' ? (
          <div
            className={`mt-3 grid gap-2 rounded-xl border p-3 ${
              isLightTheme ? 'border-rose-300 bg-rose-50' : 'border-rose-300/50 bg-rose-950/50'
            }`}
            role="alert"
          >
            <p className={`m-0 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}>{state.message}</p>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => void loadAdminData()}
              disabled={busyAction === 'INITIAL'}
            >
              Retry
            </button>
          </div>
        ) : null}

        {panelLoadingText ? <p className={`mt-2 text-sm ${mutedTextClass}`}>{panelLoadingText}</p> : null}

        <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
          <h2 className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}>Campaign Configuration</h2>
          <section
            className={`mt-3 rounded-xl border p-3 ${campaignToneClass}`}
            aria-label="Campaign status"
          >
            <p className={`m-0 inline-block rounded-full border px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] ${campaignBadgeClass}`}>
              {campaignStatus.label}
            </p>
            {campaign?.fromDate && campaign?.toDate ? (
              <p className={`mb-0 mt-2 text-base font-semibold ${isLightTheme ? 'text-slate-900' : 'text-amber-50'}`}>
                {formatDateOnly(campaign.fromDate)} {'->'} {formatDateOnly(campaign.toDate)}
              </p>
            ) : (
              <p className={`mb-0 mt-2 text-base font-semibold ${isLightTheme ? 'text-slate-900' : 'text-amber-50'}`}>Campaign period not configured.</p>
            )}
            <p className={`mb-0 mt-1 text-sm ${campaignDetailClass}`}>{campaignStatus.detail}</p>
          </section>
          <p className={`mb-0 mt-2 text-sm ${mutedTextClass}`}>Timezone: {campaign?.timezone ?? 'Asia/Kolkata'} (IST)</p>
          <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void onSaveCampaign(event)}>
            <div className="grid gap-1">
              <label htmlFor="campaign-from-date" className={`text-sm font-medium ${headingTextClass}`}>
                From Date
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <input
                  id="campaign-from-date"
                  type="date"
                  value={campaignForm.fromDate}
                  className={inputClass}
                  onChange={(event) =>
                    setCampaignForm((current) => ({
                      ...current,
                      fromDate: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setCampaignForm((current) => ({ ...current, fromDate: '' }))}
                  disabled={isBusy || !campaignForm.fromDate}
                >
                  Clear
                </button>
              </div>
              {campaignErrors.fromDate ? (
                <p className={`m-0 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}>{campaignErrors.fromDate}</p>
              ) : null}
            </div>

            <div className="grid gap-1">
              <label htmlFor="campaign-to-date" className={`text-sm font-medium ${headingTextClass}`}>
                To Date
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <input
                  id="campaign-to-date"
                  type="date"
                  value={campaignForm.toDate}
                  className={inputClass}
                  onChange={(event) =>
                    setCampaignForm((current) => ({
                      ...current,
                      toDate: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setCampaignForm((current) => ({ ...current, toDate: '' }))}
                  disabled={isBusy || !campaignForm.toDate}
                >
                  Clear
                </button>
              </div>
              {campaignErrors.toDate ? (
                <p className={`m-0 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}>{campaignErrors.toDate}</p>
              ) : null}
            </div>

            <button
              type="submit"
              className={`sm:col-span-2 sm:justify-self-start sm:min-w-40 mt-1 ${primaryButtonClass}`}
              disabled={isBusy}
            >
              {busyAction === 'CAMPAIGN' ? 'Saving...' : 'Save'}
            </button>
          </form>
        </section>

        <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
          <h2 className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}>Prize Summary</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className={`rounded-xl border p-3 ${surfaceClass}`}>
              <p className={`m-0 text-xs uppercase tracking-[0.06em] ${mutedTextClass}`}>Total Winners</p>
              <strong className={`mt-1 block text-2xl ${headingTextClass}`}>{summary?.totalSuccessfulSpins ?? 0}</strong>
            </article>
            <article className={`rounded-xl border p-3 ${surfaceClass}`}>
              <p className={`m-0 text-xs uppercase tracking-[0.06em] ${mutedTextClass}`}>Today's Winners</p>
              <strong className={`mt-1 block text-2xl ${headingTextClass}`}>{summary?.today.successfulSpins ?? 0}</strong>
              <small className={`text-xs ${mutedTextClass}`}>{summary?.today.date ? `Date ${summary.today.date}` : 'Date unavailable'}</small>
            </article>
            <article className={`rounded-xl border p-3 ${surfaceClass}`}>
              <p className={`m-0 text-xs uppercase tracking-[0.06em] ${mutedTextClass}`}>Last Claim</p>
              <strong className={`mt-1 block text-base ${headingTextClass}`}>
                {lastClaimTimestamp ? formatDateTime(lastClaimTimestamp, campaign?.timezone) : '—'}
              </strong>
              <small className={`text-xs ${mutedTextClass}`}>{lastClaimTimestamp ? 'Latest loaded claim timestamp' : 'No claims yet'}</small>
            </article>
            <article className={`rounded-xl border p-3 ${surfaceClass}`}>
              <p className={`m-0 text-xs uppercase tracking-[0.06em] ${mutedTextClass}`}>Active Prizes</p>
              <strong className={`mt-1 block text-2xl ${headingTextClass}`}>{activePrizeCount}</strong>
              <small className={`text-xs ${mutedTextClass}`}>{prizes.length} configured prizes</small>
            </article>
          </div>
        </section>

        <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
          <h2 className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}>Prize Management</h2>
          <p className={`mb-0 mt-1 text-sm ${mutedTextClass}`}>
            Prize names are fixed after creation and cannot be renamed.
          </p>
          <form
            onSubmit={(event) => void onAddPrize(event)}
            className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            noValidate
          >
            <div className="grid content-start gap-1 sm:col-span-2 lg:col-span-1">
              <label htmlFor="prize-name" className={`text-sm font-medium ${headingTextClass}`}>
                Prize Name
              </label>
              <input
                id="prize-name"
                value={addForm.name}
                className={inputClass}
                onChange={(event) => {
                  setAddForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }));
                }}
              />
              {addErrors.name ? <p className={`m-0 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}>{addErrors.name}</p> : null}
            </div>

            <div className="grid content-start gap-1 sm:col-span-2 lg:col-span-1">
              <label htmlFor="prize-weight" className={`text-sm font-medium ${headingTextClass}`}>
                Weight
              </label>
              <input
                id="prize-weight"
                type="number"
                min="0"
                step="1"
                value={addForm.weight}
                className={inputClass}
                onChange={(event) => {
                  setAddForm((current) => ({
                    ...current,
                    weight: event.target.value,
                  }));
                }}
                inputMode="numeric"
              />
              <p className={`m-0 text-xs ${mutedTextClass}`}>
                Weight is relative: for example, weight 10 has twice the draw chance of weight 5.
              </p>
              {addErrors.weight ? <p className={`m-0 text-sm ${isLightTheme ? 'text-rose-700' : 'text-rose-200'}`}>{addErrors.weight}</p> : null}
            </div>

            <div className="sm:col-span-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <label className={`inline-flex items-center gap-2 text-sm ${headingTextClass}`} htmlFor="prize-active">
                <input
                  id="prize-active"
                  type="checkbox"
                  checked={addForm.active}
                  className="h-4 w-4"
                  onChange={(event) => {
                    setAddForm((current) => ({
                      ...current,
                      active: event.target.checked,
                    }));
                  }}
                />
                Active for future draws
              </label>

              <button
                type="submit"
                className={`w-full sm:w-auto ${primaryButtonClass}`}
                disabled={isBusy}
              >
                {busyAction === 'PRIZE_ADD' ? 'Adding...' : 'Add Prize'}
              </button>
            </div>
          </form>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Prize claims filter cards">
            {sortedPrizes.map((prize) => (
              <article key={prize.id} className={`grid gap-2 rounded-xl border p-3 ${surfaceClass}`}>
                <button
                  type="button"
                  className={`grid w-full gap-2 rounded-lg border p-3 text-left ${
                    filters.prizeId === prize.id
                      ? isLightTheme
                        ? 'border-[#b88f20] bg-[#f7efdf] ring-2 ring-[#b88f20] ring-offset-2 ring-offset-[#f3e9d7]'
                        : 'border-amber-100 bg-[#1a1f47] ring-2 ring-amber-100 ring-offset-2 ring-offset-[#11153b]'
                      : isLightTheme
                        ? 'border-slate-300 bg-[#f3e9d7] hover:border-[#b88f20]'
                        : 'border-amber-300/35 bg-[#11153b] hover:border-amber-200/60'
                  }`}
                  role="radio"
                  aria-checked={filters.prizeId === prize.id}
                  aria-label={`Filter claims by ${prize.name}`}
                  onClick={() => void onSelectPrizeFilter(prize.id)}
                  onKeyDown={(event) => onPrizeFilterKeyDown(event, prize.id)}
                  disabled={isBusy}
                >
                  <header className="flex items-center justify-between gap-2">
                    <h3 className={`m-0 text-base font-semibold ${headingTextClass}`}>{prize.name}</h3>
                    <span
                      className={`rounded-full border px-2 py-1 text-[11px] font-bold tracking-[0.06em] ${
                        prize.active
                          ? isLightTheme
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-emerald-300/45 bg-emerald-950/35 text-emerald-100'
                          : isLightTheme
                            ? 'border-yellow-300 bg-yellow-50 text-yellow-700'
                            : 'border-yellow-300/45 bg-yellow-950/35 text-yellow-100'
                      }`}
                    >
                      {prize.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </header>
                  <p className={`m-0 text-sm ${mutedTextClass}`}>Weight: {prize.weight}</p>
                  <p className={`m-0 text-sm ${mutedTextClass}`}>Given: {givenByPrizeId.get(prize.id) ?? prize.givenCount ?? 0}</p>
                </button>
                <div className="grid gap-2">
                  <label htmlFor={`weight-${prize.id}`} className={`text-sm font-medium ${headingTextClass}`}>
                    Weight
                  </label>
                  <input
                    id={`weight-${prize.id}`}
                    type="number"
                    min="0"
                    step="1"
                    value={weightDrafts[prize.id] ?? String(prize.weight)}
                    onChange={(event) => {
                      setWeightDrafts((current) => ({
                        ...current,
                        [prize.id]: event.target.value,
                      }));
                    }}
                    onClick={(event) => event.stopPropagation()}
                    className={inputClass}
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    className={primaryButtonClass}
                    onClick={() => void onSaveWeight(prize)}
                    disabled={isBusy}
                  >
                    {busyAction === 'PRIZE_WEIGHT' ? 'Saving...' : 'Save Weight'}
                  </button>
                </div>
                <label className={`inline-flex items-center gap-2 text-sm ${headingTextClass}`} htmlFor={`active-${prize.id}`}>
                  <input
                    id={`active-${prize.id}`}
                    type="checkbox"
                    checked={prize.active}
                    className="h-4 w-4"
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => void onToggleActive(prize)}
                    disabled={isBusy}
                  />
                  Active
                </label>
              </article>
            ))}
          </div>
        </section>

        <section className={`mt-4 border-t pt-4 ${sectionBorderClass}`}>
          <h2 className={`m-0 text-base font-semibold uppercase tracking-[0.04em] ${headingTextClass}`}>Claims</h2>
          <form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => void onApplyFilters(event)}>
            <div className="grid content-start gap-1">
              <label htmlFor="claims-search" className={`text-sm font-medium ${headingTextClass}`}>
                Search
              </label>
              <input
                id="claims-search"
                value={filters.search}
                className={inputClass}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
              />
            </div>

            <div className="grid content-start gap-1">
              <label htmlFor="claims-prize-filter" className={`text-sm font-medium ${headingTextClass}`}>
                Prize
              </label>
              <select
                id="claims-prize-filter"
                value={filters.prizeId}
                className={inputClass}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    prizeId: event.target.value,
                  }))
                }
              >
                <option value="">All Prizes</option>
                {sortedPrizes.map((prize) => (
                  <option key={prize.id} value={prize.id}>
                    {prize.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid content-start gap-1">
              <label htmlFor="claims-from" className={`text-sm font-medium ${headingTextClass}`}>
                From Date (Filter)
              </label>
              <input
                id="claims-from"
                type="date"
                value={filters.from}
                className={inputClass}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
            </div>

            <div className="grid content-start gap-1">
              <label htmlFor="claims-to" className={`text-sm font-medium ${headingTextClass}`}>
                To Date (Filter)
              </label>
              <input
                id="claims-to"
                type="date"
                value={filters.to}
                className={inputClass}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
              />
            </div>

            <div className="grid content-start gap-1">
              <label htmlFor="claims-page-size" className={`text-sm font-medium ${headingTextClass}`}>
                Page Size
              </label>
              <select
                id="claims-page-size"
                value={filters.pageSize}
                className={inputClass}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    pageSize: event.target.value,
                  }))
                }
              >
                {claimsPageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3 lg:col-span-5 lg:w-full lg:grid-cols-4">
              <button
                type="submit"
                className={primaryButtonClass}
                disabled={isBusy}
              >
                {busyAction === 'CLAIMS' ? 'Applying...' : 'Apply Filters'}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={isBusy || !hasActiveFilters}
                onClick={() => void onClearFilters()}
              >
                Clear Filters
              </button>
              <button
                type="button"
                className={`justify-self-start sm:justify-self-end ${primaryButtonClass}`}
                disabled={isBusy}
                onClick={() => void onExportCsv()}
              >
                {busyAction === 'CSV' ? 'Exporting...' : 'Export All Data'}
              </button>
              <button
                type="button"
                className={dangerButtonClass}
                disabled={isBusy || claims.length === 0}
                onClick={() => void onClearAllClaims()}
              >
                {busyAction === 'CLAIMS_CLEAR' ? 'Clearing...' : 'Clear All Claims'}
              </button>
            </div>
          </form>

          <div className="mt-3 overflow-x-hidden">
            {claims.length > 0 ? (
              <>
                <table
                  className={`hidden w-full border-separate border-spacing-0 sm:table ${
                    isLightTheme ? 'border border-solid border-[#d4af37]' : 'border border-solid border-amber-300/25'
                  }`}
                  aria-label="Claims table"
                >
                  <thead className={isLightTheme ? 'bg-[#ece1cc] text-slate-700' : 'bg-[#1b143d] text-amber-100'}>
                    <tr>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Claim ID</th>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Customer</th>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Phone</th>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Bill Number</th>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Prize</th>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Date/Time</th>
                      <th className={`border border-solid px-2 py-2 text-left text-xs uppercase tracking-[0.06em] ${isLightTheme ? 'border-[#d4af37]' : 'border-amber-300/25'}`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim, index) => (
                      <tr
                        key={claim.claimId}
                        className={isLightTheme ? (index % 2 === 0 ? 'bg-[#f8f0e1]' : 'bg-[#f2e7d3]') : index % 2 === 0 ? 'bg-[#12163a]' : 'bg-[#101334]'}
                      >
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{claim.claimId}</span>
                            <button
                              type="button"
                              className={smallSecondaryButtonClass}
                              aria-label={`Copy claim ID ${claim.claimId}`}
                              onClick={() => void onCopyClaimId(claim.claimId)}
                            >
                              {copiedClaimId === claim.claimId ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        </td>
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>{claim.customerName}</td>
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>{claim.maskedPhone}</td>
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>{claim.billNumber}</td>
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>{claim.prize}</td>
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>{formatDateTime(claim.claimTimestamp, campaign?.timezone)}</td>
                        <td className={`border border-solid px-2 py-2 text-sm ${isLightTheme ? 'border-[#d4af37] text-slate-700' : 'border-amber-300/20 text-amber-100'}`}>
                          <button
                            type="button"
                            className={smallDangerButtonClass}
                            disabled={isBusy}
                            aria-label={`Delete claim ${claim.claimId}`}
                            onClick={() => void onDeleteClaim(claim.claimId)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grid gap-2 sm:hidden" aria-label="Claims list">
                  {claims.map((claim) => (
                    <article key={`mobile-${claim.claimId}`} className={`grid gap-2 rounded-xl border p-3 ${surfaceClass}`}>
                      <div className="grid gap-1">
                        <p className={`m-0 text-[11px] font-bold uppercase tracking-[0.08em] ${mutedTextClass}`}>Claim</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{claim.claimId}</strong>
                          <button
                            type="button"
                            className={smallSecondaryButtonClass}
                            aria-label={`Copy claim ID ${claim.claimId}`}
                            onClick={() => void onCopyClaimId(claim.claimId)}
                          >
                            {copiedClaimId === claim.claimId ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <dl className="m-0 grid gap-2">
                        <div className="grid gap-0.5">
                          <dt className={`m-0 text-[11px] uppercase tracking-[0.06em] ${mutedTextClass}`}>Customer</dt>
                          <dd className={`m-0 text-sm ${headingTextClass}`}>{claim.customerName}</dd>
                        </div>
                        <div className="grid gap-0.5">
                          <dt className={`m-0 text-[11px] uppercase tracking-[0.06em] ${mutedTextClass}`}>Phone</dt>
                          <dd className={`m-0 text-sm ${headingTextClass}`}>{claim.maskedPhone}</dd>
                        </div>
                        <div className="grid gap-0.5">
                          <dt className={`m-0 text-[11px] uppercase tracking-[0.06em] ${mutedTextClass}`}>Bill</dt>
                          <dd className={`m-0 text-sm ${headingTextClass}`}>{claim.billNumber}</dd>
                        </div>
                        <div className="grid gap-0.5">
                          <dt className={`m-0 text-[11px] uppercase tracking-[0.06em] ${mutedTextClass}`}>Prize</dt>
                          <dd className={`m-0 text-sm ${headingTextClass}`}>{claim.prize}</dd>
                        </div>
                        <div className="grid gap-0.5">
                          <dt className={`m-0 text-[11px] uppercase tracking-[0.06em] ${mutedTextClass}`}>Claimed</dt>
                          <dd className={`m-0 text-sm ${headingTextClass}`}>{formatDateTime(claim.claimTimestamp, campaign?.timezone)}</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className={smallDangerButtonClass}
                        disabled={isBusy}
                        aria-label={`Delete claim ${claim.claimId}`}
                        onClick={() => void onDeleteClaim(claim.claimId)}
                      >
                        Delete
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className={`rounded-xl border border-dashed p-3 ${isLightTheme ? 'border-slate-300 bg-[#f3e9d7]' : 'border-amber-300/35 bg-[#11153b]'}`} role="status">
                <p className={`m-0 text-sm font-semibold ${headingTextClass}`}>
                  {filters.prizeId ? 'No claims found for this prize.' : hasActiveFilters ? 'No claims match your filters.' : 'No claims yet.'}
                </p>
                <p className={`mb-0 mt-1 text-sm ${mutedTextClass}`}>
                  {filters.prizeId
                    ? `${filteredPrizeName ?? 'Selected prize'} has no successful claims in this view.`
                    : hasActiveFilters
                    ? 'Adjust or clear filters to load more claims.'
                    : 'Successful lucky-draw claims will appear here.'}
                </p>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    className={`mt-2 ${secondaryButtonClass}`}
                    onClick={() => void onClearFilters()}
                    disabled={isBusy}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={isBusy || pageTokens.length === 0}
              onClick={() => void onPreviousPage()}
            >
              Previous
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={isBusy || !nextPageToken}
              onClick={() => void onNextPage()}
            >
              Next
            </button>
          </div>

          {lastCsvExport ? (
            <details className={csvPanelClass}>
              <summary className={csvPanelSummaryClass}>Last CSV Preview</summary>
              <pre className={csvPanelPreviewClass}>
                {lastCsvExport}
              </pre>
            </details>
          ) : null}
        </section>

        {statusMessage ? (
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm" role="status" aria-live="polite">
            <div
              className={`rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
                isLightTheme
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-emerald-300/45 bg-emerald-950/95 text-emerald-100'
              }`}
            >
              {statusMessage}
            </div>
          </div>
        ) : null}

        {confirmDialog ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="presentation">
            <div
              className={`grid w-full max-w-md gap-3 rounded-2xl border p-5 shadow-xl ${surfaceClass}`}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
            >
              {confirmDialog.type === 'DELETE_CLAIM' ? (
                <>
                  <h2 id="confirm-dialog-title" className={`m-0 text-lg font-semibold ${headingTextClass}`}>
                    Delete claim {confirmDialog.claimId}?
                  </h2>
                  <p className={`m-0 text-sm ${mutedTextClass}`}>
                    This permanently removes the claim and adjusts prize and summary counts. This cannot be undone.
                  </p>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button type="button" className={secondaryButtonClass} onClick={() => setConfirmDialog(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={dangerButtonClass}
                      onClick={() => void onConfirmDeleteClaim(confirmDialog.claimId)}
                    >
                      Delete Claim
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 id="confirm-dialog-title" className={`m-0 text-lg font-semibold ${headingTextClass}`}>
                    Clear all claims?
                  </h2>
                  <p className={`m-0 text-sm ${mutedTextClass}`}>
                    This permanently deletes ALL claims and resets prize and summary counts to zero. This cannot be
                    undone.
                  </p>
                  <label htmlFor="clear-all-confirmation" className={`text-sm font-medium ${headingTextClass}`}>
                    Type {CLEAR_ALL_CONFIRMATION_PHRASE} to confirm
                  </label>
                  <input
                    id="clear-all-confirmation"
                    type="text"
                    className={inputClass}
                    value={clearAllConfirmationText}
                    onChange={(event) => setClearAllConfirmationText(event.target.value)}
                    autoComplete="off"
                  />
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button type="button" className={secondaryButtonClass} onClick={() => setConfirmDialog(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={dangerButtonClass}
                      disabled={clearAllConfirmationText !== CLEAR_ALL_CONFIRMATION_PHRASE}
                      onClick={() => void onConfirmClearAllClaims()}
                    >
                      Clear All Claims
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
};

const formatDateTime = (isoText: string, timezone: string = 'Asia/Kolkata'): string => {
  const value = new Date(isoText);
  if (Number.isNaN(value.getTime())) {
    return isoText;
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(value);
};

const formatDateOnly = (isoDateText: string): string => {
  if (!isValidIsoDate(isoDateText)) {
    return isoDateText;
  }

  const date = new Date(`${isoDateText}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const campaignDateInTimezone = (value: Date, timezone: string): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(value);
};

const isValidIsoDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
};

const toUtcRangeBoundary = (isoDateText: string, boundary: 'start' | 'end'): string | undefined => {
  if (!isoDateText || !isValidIsoDate(isoDateText)) {
    return undefined;
  }

  return boundary === 'start'
    ? `${isoDateText}T00:00:00.000Z`
    : `${isoDateText}T23:59:59.999Z`;
};

const firstError = (
  ...responses: Array<{ status: 'SUCCESS' } | AdminErrorResponse>
): AdminErrorResponse | null => {
  for (const response of responses) {
    if (response.status === 'ERROR') {
      return response;
    }
  }

  return null;
};
