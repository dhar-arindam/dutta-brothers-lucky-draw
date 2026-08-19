import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createIdempotencyKey, DrawApiError, submitDraw } from './services/draw-api';
import type { DrawErrorResponse, DrawRequest, DrawResponse } from './types';
import giftBoxClosedHeroImage from './assets/giftbox/giftbox_closed_hero.png';
import giftBoxOpenImage from './assets/giftbox/giftbox-open.png';
import reveal01Image from './assets/giftbox/reveal-01.png';
import reveal02Image from './assets/giftbox/reveal-02.png';
import reveal03Image from './assets/giftbox/reveal-03.png';
import reveal04Image from './assets/giftbox/reveal-04.png';
import reveal05Image from './assets/giftbox/reveal-05.png';
import reveal06Image from './assets/giftbox/reveal-06.png';
import reveal07Image from './assets/giftbox/reveal-07.png';
import { FormErrors, validateForm } from './validation';

type UiState =
  | { type: 'LANDING' }
  | { type: 'FORM' }
  | { type: 'VALIDATING' }
  | { type: 'CHECKING_ELIGIBILITY' }
  | {
      type: 'ALREADY_CLAIMED';
      response: Extract<DrawResponse, { status: 'ALREADY_CLAIMED' }>;
    }
  | { type: 'DRAW_ENDED'; message: string }
  | { type: 'NO_ELIGIBLE_PRIZE'; message: string }
  | { type: 'API_ERROR'; message: string }
  | { type: 'NETWORK_ERROR'; message: string }
  | { type: 'RETRY' };

const emptyRequest: DrawRequest = {
  name: '',
  phone: '',
  billNumber: '',
};

const REVEAL_MS = 900;
const ANTICIPATION_MS = 1000;
const REDUCED_ANTICIPATION_MS = 130;
const OPENING_TO_CELEBRATION_MS = 260;
const REVEAL_FRAME_INTERVAL_MS = 95;
const RESULT_ENTER_START_MS = 620;
const REDUCED_RESULT_ENTER_START_MS = 120;
const REDUCED_REVEAL_MS = 320;

type RevealModalState = 'HIDDEN' | 'ANTICIPATION' | 'BOX_REVEAL' | 'RESULT';

interface SubmittedDrawAttempt {
  request: DrawRequest;
  idempotencyKey: string;
}

const REVEAL_SEQUENCE_IMAGES = [
  reveal01Image,
  reveal02Image,
  reveal03Image,
  reveal04Image,
  reveal05Image,
  reveal06Image,
  reveal07Image,
] as const;

const usePrefersReducedMotion = (): boolean => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReducedMotion(mediaQuery.matches);
    };

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return reducedMotion;
};

export const App = () => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [formValue, setFormValue] = useState<DrawRequest>(emptyRequest);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [uiState, setUiState] = useState<UiState>({ type: 'LANDING' });
  const [lastSubmittedAttempt, setLastSubmittedAttempt] = useState<SubmittedDrawAttempt | null>(null);
  const [pendingSuccessResponse, setPendingSuccessResponse] = useState<
    Extract<DrawResponse, { status: 'SUCCESS' }> | null
  >(null);
  const [resolvedSuccessResponse, setResolvedSuccessResponse] = useState<
    Extract<DrawResponse, { status: 'SUCCESS' }> | null
  >(null);
  const [revealModalState, setRevealModalState] = useState<RevealModalState>('HIDDEN');
  const [isBoxOpened, setIsBoxOpened] = useState(false);
  const [revealFrameIndex, setRevealFrameIndex] = useState(0);
  const [presentationState, setPresentationState] = useState<
    'ANTICIPATION' | 'BOX_IDLE' | 'BOX_OPENING' | 'CELEBRATION' | 'RESULT_ENTERING' | 'RESULT' | 'NONE'
  >('NONE');

  const stateHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const anticipationTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const resultEnterTimerRef = useRef<number | null>(null);
  const celebrationTimerRef = useRef<number | null>(null);
  const revealFrameTimerRef = useRef<number | null>(null);
  const hasCommittedRevealResultRef = useRef(false);
  const primarySubmitRef = useRef<HTMLButtonElement | null>(null);
  const revealOverlayRef = useRef<HTMLElement | null>(null);

  const isSubmitting =
    uiState.type === 'CHECKING_ELIGIBILITY' ||
    uiState.type === 'RETRY';
  const isDrawClosed = uiState.type === 'DRAW_ENDED' || uiState.type === 'NO_ELIGIBLE_PRIZE';
  const isSubmitDisabled = isSubmitting || isDrawClosed;
  const isFormExperience = uiState.type !== 'LANDING';
  const isOverlayVisible = revealModalState !== 'HIDDEN';

  useEffect(() => {
    if (revealModalState !== 'ANTICIPATION' || !pendingSuccessResponse) {
      return;
    }

    setPresentationState('ANTICIPATION');
    const delayMs = prefersReducedMotion ? REDUCED_ANTICIPATION_MS : ANTICIPATION_MS;
    const timeout = window.setTimeout(() => {
      setRevealModalState('BOX_REVEAL');
      anticipationTimerRef.current = null;
    }, delayMs);

    anticipationTimerRef.current = timeout;

    return () => {
      window.clearTimeout(timeout);
      if (anticipationTimerRef.current === timeout) {
        anticipationTimerRef.current = null;
      }
    };
  }, [pendingSuccessResponse, prefersReducedMotion, revealModalState]);

  useEffect(() => {
    if (revealModalState !== 'BOX_REVEAL') {
      return;
    }

    hasCommittedRevealResultRef.current = false;
    setIsBoxOpened(false);
    setRevealFrameIndex(0);
    setPresentationState('BOX_IDLE');
  }, [revealModalState]);

  useEffect(() => {
    if (
      revealModalState !== 'RESULT' &&
      uiState.type !== 'ALREADY_CLAIMED' &&
      uiState.type !== 'DRAW_ENDED' &&
      uiState.type !== 'NO_ELIGIBLE_PRIZE' &&
      uiState.type !== 'API_ERROR' &&
      uiState.type !== 'NETWORK_ERROR'
    ) {
      return;
    }

    stateHeadingRef.current?.focus();
  }, [revealModalState, uiState.type]);

  useEffect(() => {
    if (!isOverlayVisible) {
      setPresentationState('NONE');
      return;
    }

    revealOverlayRef.current?.focus();
  }, [isOverlayVisible]);

  useEffect(() => {
    return () => {
      if (anticipationTimerRef.current !== null) {
        window.clearTimeout(anticipationTimerRef.current);
      }

      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }

      if (resultEnterTimerRef.current !== null) {
        window.clearTimeout(resultEnterTimerRef.current);
      }

      if (celebrationTimerRef.current !== null) {
        window.clearTimeout(celebrationTimerRef.current);
      }

      if (revealFrameTimerRef.current !== null) {
        window.clearInterval(revealFrameTimerRef.current);
      }
    };
  }, []);

  const resetToIdleIfAllowed = (): void => {
    if (!isSubmitting && !isDrawClosed) {
      setUiState({ type: 'FORM' });
    }
  };

  const onStartDraw = (): void => {
    if (isDrawClosed) {
      return;
    }

    setUiState({ type: 'FORM' });
  };

  const headingText = useMemo(() => {
    switch (uiState.type) {
      case 'LANDING':
        return 'Your Festive Lucky Draw';
      case 'FORM':
      case 'VALIDATING':
      case 'CHECKING_ELIGIBILITY':
      case 'API_ERROR':
      case 'NETWORK_ERROR':
      case 'RETRY':
        return 'Enter Your Details';
      case 'ALREADY_CLAIMED':
        return 'This bill has already been used';
      case 'DRAW_ENDED':
        return 'Draw closed for now';
      case 'NO_ELIGIBLE_PRIZE':
        return 'Draw update';
      default:
        return 'Dutta Brothers Festive Lucky Draw';
    }
  }, [uiState.type]);

  const stateAnnouncement = useMemo(() => {
    if (revealModalState === 'ANTICIPATION') {
      return 'Preparing your festive reveal.';
    }

    if (revealModalState === 'BOX_REVEAL') {
      return 'Gift box ready. Tap to open your lucky box.';
    }

    if (revealModalState === 'RESULT' && resolvedSuccessResponse) {
      return `Result ready. You won ${resolvedSuccessResponse.prize.displayName}. Claim ID ${resolvedSuccessResponse.claimId}.`;
    }

    switch (uiState.type) {
      case 'LANDING':
        return 'Landing screen loaded.';
      case 'FORM':
        return 'Form screen ready.';
      case 'CHECKING_ELIGIBILITY':
        return 'Preparing your reveal.';
      case 'ALREADY_CLAIMED':
        return 'This bill has already been used.';
      case 'DRAW_ENDED':
      case 'NO_ELIGIBLE_PRIZE':
      case 'API_ERROR':
      case 'NETWORK_ERROR':
        return headingText;
      default:
        return '';
    }
  }, [headingText, resolvedSuccessResponse, revealModalState, uiState]);

  const handleErrorResponse = (response: DrawErrorResponse): void => {
    if (response.code === 'VALIDATION_ERROR') {
      setFormErrors(response.fieldErrors ?? {});
      setUiState({ type: 'FORM' });
      return;
    }

    if (response.code === 'DRAW_ENDED') {
      setUiState({ type: 'DRAW_ENDED', message: response.message });
      return;
    }

    if (response.code === 'NO_ELIGIBLE_PRIZE') {
      setUiState({ type: 'NO_ELIGIBLE_PRIZE', message: response.message });
      return;
    }

    if (response.code === 'NETWORK_ERROR') {
      setUiState({ type: 'NETWORK_ERROR', message: response.message });
      return;
    }

    setUiState({ type: 'API_ERROR', message: response.message });
  };

  const submitDrawRequest = useCallback(async (attempt: SubmittedDrawAttempt): Promise<void> => {
    setUiState({ type: 'CHECKING_ELIGIBILITY' });

    try {
      const response = await submitDraw(attempt.request, {
        idempotencyKey: attempt.idempotencyKey,
      });

      if (response.status === 'SUCCESS') {
        setResolvedSuccessResponse(null);
        setPendingSuccessResponse(response);
        setRevealModalState('ANTICIPATION');
        setUiState({ type: 'FORM' });
        return;
      }

      if (response.status === 'ALREADY_CLAIMED') {
        setUiState({ type: 'ALREADY_CLAIMED', response });
        return;
      }

      handleErrorResponse(response);
    } catch (error) {
      if (error instanceof DrawApiError && error.code === 'NETWORK_ERROR') {
        setUiState({
          type: 'NETWORK_ERROR',
          message: error.message,
        });
        return;
      }

      setUiState({
        type: 'API_ERROR',
        message: 'We could not complete the draw. Please try again.',
      });
    }
  }, []);

  useEffect(() => {
    if (uiState.type !== 'RETRY' || !lastSubmittedAttempt) {
      return;
    }

    void submitDrawRequest(lastSubmittedAttempt);
  }, [lastSubmittedAttempt, submitDrawRequest, uiState.type]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitDisabled) {
      return;
    }

    setUiState({ type: 'VALIDATING' });

    const validationErrors = validateForm(formValue);
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      setUiState({ type: 'FORM' });
      return;
    }

    setFormErrors({});
    const attempt: SubmittedDrawAttempt = {
      request: { ...formValue },
      idempotencyKey: createIdempotencyKey(),
    };
    setLastSubmittedAttempt(attempt);
    await submitDrawRequest(attempt);
  };

  const onRetry = () => {
    if (!lastSubmittedAttempt || isSubmitting || isDrawClosed) {
      return;
    }

    setUiState({ type: 'RETRY' });
  };

  const commitRevealResult = useCallback(() => {
    if (hasCommittedRevealResultRef.current) {
      return;
    }

    hasCommittedRevealResultRef.current = true;

    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    if (resultEnterTimerRef.current !== null) {
      window.clearTimeout(resultEnterTimerRef.current);
      resultEnterTimerRef.current = null;
    }

    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }

    setPresentationState('RESULT');
    setRevealModalState('RESULT');
    setPendingSuccessResponse(null);
  }, []);

  const onOpenBox = () => {
    if (revealModalState !== 'BOX_REVEAL' || !pendingSuccessResponse || isBoxOpened) {
      return;
    }

    setIsBoxOpened(true);
    setPresentationState('BOX_OPENING');
    hasCommittedRevealResultRef.current = false;

    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    if (resultEnterTimerRef.current !== null) {
      window.clearTimeout(resultEnterTimerRef.current);
      resultEnterTimerRef.current = null;
    }

    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }

    if (!prefersReducedMotion) {
      if (revealFrameTimerRef.current !== null) {
        window.clearInterval(revealFrameTimerRef.current);
      }

      revealFrameTimerRef.current = window.setInterval(() => {
        setRevealFrameIndex((current) => {
          if (current >= REVEAL_SEQUENCE_IMAGES.length - 1) {
            if (revealFrameTimerRef.current !== null) {
              window.clearInterval(revealFrameTimerRef.current);
              revealFrameTimerRef.current = null;
            }
            return current;
          }

          return current + 1;
        });
      }, REVEAL_FRAME_INTERVAL_MS);
    } else {
      setRevealFrameIndex(REVEAL_SEQUENCE_IMAGES.length - 1);
    }

    celebrationTimerRef.current = window.setTimeout(() => {
      setPresentationState('CELEBRATION');
      celebrationTimerRef.current = null;
    }, prefersReducedMotion ? 80 : OPENING_TO_CELEBRATION_MS);

    resultEnterTimerRef.current = window.setTimeout(() => {
      setPresentationState('RESULT_ENTERING');
      setResolvedSuccessResponse(pendingSuccessResponse);
      resultEnterTimerRef.current = null;
    }, prefersReducedMotion ? REDUCED_RESULT_ENTER_START_MS : RESULT_ENTER_START_MS);

    revealTimerRef.current = window.setTimeout(() => {
      commitRevealResult();
    }, prefersReducedMotion ? REDUCED_REVEAL_MS : REVEAL_MS);
  };

  const closeRevealOverlayToForm = () => {
    if (revealFrameTimerRef.current !== null) {
      window.clearInterval(revealFrameTimerRef.current);
      revealFrameTimerRef.current = null;
    }

    setRevealModalState('HIDDEN');
    setPendingSuccessResponse(null);
    setResolvedSuccessResponse(null);
    hasCommittedRevealResultRef.current = false;
    setIsBoxOpened(false);
    setRevealFrameIndex(0);
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    if (resultEnterTimerRef.current !== null) {
      window.clearTimeout(resultEnterTimerRef.current);
      resultEnterTimerRef.current = null;
    }

    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }
    returnToForm();
    window.setTimeout(() => {
      primarySubmitRef.current?.focus();
    }, 0);
  };

  const returnToForm = () => {
    if (isDrawClosed) {
      setUiState({ type: 'LANDING' });
      return;
    }

    setUiState({ type: 'FORM' });
  };

  return (
    <main className="app-shell" aria-label="Customer draw page">
      <section className={`customer-card${isOverlayVisible ? ' overlay-active' : ''}`} data-state={isOverlayVisible ? revealModalState : uiState.type}>
        <p className="brand-kicker">DUTTA BROTHERS</p>
        <p className="campaign-tag">DURGA PUJA &amp; DIWALI DHAMAKA</p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {stateAnnouncement}
        </p>

        {uiState.type === 'LANDING' ? (
          <section className="landing-view" data-testid="landing-view">
            <p className="step-chip">Festive Campaign</p>
            <p className="hero-message">A festive reward is waiting for you.</p>
            <div className="landing-gift-hero" aria-hidden="true">
              <img src={giftBoxClosedHeroImage} alt="" className="landing-gift-image" />
            </div>
            <button className="primary-cta" type="button" onClick={onStartDraw}>
              Start Your Lucky Draw
            </button>
            <p className="micro-trust">100% Genuine • Secure • Trusted</p>
          </section>
        ) : null}

        {isFormExperience ? (
          <section className="form-view" data-testid="form-view">
            <h1>Enter Your Details</h1>
            <p className="card-subtitle">Your festive surprise is moments away.</p>

            <form onSubmit={onSubmit} noValidate aria-busy={isSubmitting}>
              <fieldset className="draw-form-fields" disabled={isSubmitting}>
                <label htmlFor="name">Full Name</label>
                <input
                  id="name"
                  name="name"
                  value={formValue.name}
                  onChange={(event) => {
                    setFormValue((current) => ({
                      ...current,
                      name: event.target.value,
                    }));
                    resetToIdleIfAllowed();
                  }}
                  autoCorrect="off"
                  autoCapitalize="words"
                  aria-invalid={Boolean(formErrors.name)}
                  aria-describedby={formErrors.name ? 'name-error' : undefined}
                  maxLength={100}
                />
                {formErrors.name ? (
                  <p className="error-text" id="name-error" role="alert">
                    {formErrors.name}
                  </p>
                ) : null}

                <label htmlFor="phone">Phone Number</label>
                <input
                  id="phone"
                  name="phone"
                  value={formValue.phone}
                  onChange={(event) => {
                    setFormValue((current) => ({
                      ...current,
                      phone: event.target.value,
                    }));
                    resetToIdleIfAllowed();
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  autoComplete="tel"
                  aria-invalid={Boolean(formErrors.phone)}
                  aria-describedby={formErrors.phone ? 'phone-error' : undefined}
                />
                {formErrors.phone ? (
                  <p className="error-text" id="phone-error" role="alert">
                    {formErrors.phone}
                  </p>
                ) : null}

                <label htmlFor="bill-number">Bill Number</label>
                <input
                  id="bill-number"
                  name="billNumber"
                  value={formValue.billNumber}
                  onChange={(event) => {
                    setFormValue((current) => ({
                      ...current,
                      billNumber: event.target.value,
                    }));
                    resetToIdleIfAllowed();
                  }}
                  autoCorrect="off"
                  autoCapitalize="characters"
                  aria-invalid={Boolean(formErrors.billNumber)}
                  aria-describedby={formErrors.billNumber ? 'bill-error' : undefined}
                  maxLength={50}
                />
                {formErrors.billNumber ? (
                  <p className="error-text" id="bill-error" role="alert">
                    {formErrors.billNumber}
                  </p>
                ) : null}

                <button className="primary-cta" type="submit" disabled={isSubmitDisabled} ref={primarySubmitRef}>
                  PLAY NOW
                  <span className="cta-motif" aria-hidden="true" />
                </button>
              </fieldset>
            </form>

            {uiState.type === 'API_ERROR' || uiState.type === 'NETWORK_ERROR' ? (
              <section className="result error" aria-live="polite" aria-atomic="true" role="alert">
                <h2 className="result-heading" tabIndex={-1} ref={stateHeadingRef}>
                  {uiState.type === 'NETWORK_ERROR' ? 'Connection issue' : 'Please try again'}
                </h2>
                <p>{uiState.message}</p>
                <button type="button" className="retry-button" onClick={onRetry}>
                  Retry
                </button>
              </section>
            ) : null}
          </section>
        ) : null}

        {isOverlayVisible ? (
          <section
            className="reveal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Festive lucky reveal"
            data-testid="reveal-overlay"
            data-modal-state={revealModalState}
            data-presentation-state={presentationState}
            ref={revealOverlayRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') {
                return;
              }

              if (revealModalState === 'RESULT') {
                event.preventDefault();
                closeRevealOverlayToForm();
                return;
              }

              if (revealModalState === 'BOX_REVEAL') {
                event.preventDefault();
                return;
              }

              if (revealModalState === 'ANTICIPATION') {
                event.preventDefault();
              }
            }}
          >
            {revealModalState === 'ANTICIPATION' ? (
              <section
                className="anticipation-view"
                data-testid="anticipation-view"
                data-presentation-state={presentationState}
                aria-label="Preparing your festive reveal"
              >
                <div className="anticipation-drop-wrap" aria-hidden="true">
                  <img src={giftBoxClosedHeroImage} alt="" className="anticipation-drop-box" />
                </div>
                <h2 className="overlay-title">GET READY</h2>
                <p className="status-text">Preparing your festive reveal...</p>
              </section>
            ) : null}

            {revealModalState === 'BOX_REVEAL' && pendingSuccessResponse ? (
              <section
                className="reveal-view"
                data-testid="reveal-view"
                data-presentation-state={presentationState}
                aria-label="Festive gift box reveal"
              >
                <h2 className="overlay-title">TAP TO OPEN</h2>

                <button
                  className={`gift-box-trigger${isBoxOpened ? ' is-open' : ''}`}
                  data-testid="gift-box-hero"
                  data-state={revealModalState}
                  data-presentation-state={presentationState}
                  type="button"
                  onClick={onOpenBox}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenBox();
                    }
                  }}
                  disabled={isBoxOpened}
                  aria-label={isBoxOpened ? 'Opening your lucky box' : 'Tap to open your lucky box'}
                >
                  <span className={`gift-box-wrap${revealFrameIndex === REVEAL_SEQUENCE_IMAGES.length - 1 ? ' is-final-frame' : ''}`} aria-hidden="true">
                    <img
                      src={REVEAL_SEQUENCE_IMAGES[revealFrameIndex]}
                      alt=""
                      className={`gift-box-reveal-frame frame-${revealFrameIndex + 1}`}
                    />
                  </span>
                </button>
              </section>
            ) : null}

            {(revealModalState === 'RESULT' || presentationState === 'RESULT_ENTERING') && resolvedSuccessResponse ? (
              <section
                className="result success result-view overlay-result-layer"
                data-testid="result-view"
                data-presentation-state={presentationState}
                aria-live="polite"
                aria-atomic="true"
                onTransitionEnd={(event) => {
                  if (presentationState !== 'RESULT_ENTERING' || revealModalState !== 'BOX_REVEAL') {
                    return;
                  }

                  if (event.target !== event.currentTarget) {
                    return;
                  }

                  if (event.propertyName !== 'opacity' && event.propertyName !== 'transform') {
                    return;
                  }

                  commitRevealResult();
                }}
              >
                <h2 className="result-heading" tabIndex={-1} ref={stateHeadingRef}>
                  CONGRATULATIONS!
                </h2>
                <p className="celebration-tag">YOU WON!</p>
                <section className="prize-showcase" aria-label="Prize card">
                  <img src={giftBoxOpenImage} alt="" className="prize-art-image" aria-hidden="true" />
                  <p className="highlight">{resolvedSuccessResponse.prize.displayName}</p>
                </section>
                <p className="claim-id-row">
                  Claim ID: <span className="claim-id-value">{resolvedSuccessResponse.claimId}</span>
                </p>
                <p>Show this at the Dutta Brothers counter.</p>
                <div className="overlay-actions">
                  <button type="button" className="retry-button" onClick={closeRevealOverlayToForm}>
                    Play Another Draw
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {uiState.type === 'ALREADY_CLAIMED' ? (
          <section className="result info" aria-live="polite" aria-atomic="true">
            <h2 className="result-heading" tabIndex={-1} ref={stateHeadingRef}>
              Already Claimed
            </h2>
            <p>{uiState.response.message}</p>
            <p>
              Original Prize: <span className="claim-id-value">{uiState.response.prize.displayName}</span>
            </p>
            <p className="claim-id-row">
              Claim ID: <span className="claim-id-value">{uiState.response.claimId}</span>
            </p>
            <button type="button" className="retry-button" onClick={returnToForm}>
              Try another bill
            </button>
          </section>
        ) : null}

        {uiState.type === 'DRAW_ENDED' || uiState.type === 'NO_ELIGIBLE_PRIZE' ? (
          <section className="result warning" aria-live="polite" aria-atomic="true">
            <h2 className="result-heading" tabIndex={-1} ref={stateHeadingRef}>
              {uiState.type === 'DRAW_ENDED' ? 'Draw Ended' : 'No Eligible Prize'}
            </h2>
            <p>{uiState.message}</p>
            <p className="availability-note">Please visit the Dutta Brothers counter for assistance.</p>
            <button type="button" className="retry-button" onClick={returnToForm}>
              Back
            </button>
          </section>
        ) : null}
      </section>
    </main>
  );
};
