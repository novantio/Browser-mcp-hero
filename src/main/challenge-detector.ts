import type { WebContents } from 'electron';

export interface ChallengeDetectionResult {
  detected: boolean;
  provider?: 'cloudflare_turnstile' | 'google_recaptcha' | 'hcaptcha' | 'arkose_labs' | 'cloudflare_wait_screen' | 'custom';
  details?: string;
}

/**
 * Runs inside the browser page; serialized without module dependencies.
 * Analyzes the DOM, frames, and page indicators for known bot protection challenges.
 */
export function checkPageChallenge(): ChallengeDetectionResult {
  const title = (document.title || '').toLowerCase();
  const bodyText = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toLowerCase();

  // 1. Cloudflare Wait Screen / Challenge Page
  if (
    title.includes('just a moment...') ||
    title.includes('attention required! | cloudflare') ||
    document.querySelector('#challenge-running, #challenge-stage, #cf-challenge-running, #challenge-body-text') ||
    (bodyText.includes('checking your browser before accessing') && bodyText.includes('cloudflare'))
  ) {
    return {
      detected: true,
      provider: 'cloudflare_wait_screen',
      details: 'Cloudflare bot verification / wait screen terdeteksi di halaman.',
    };
  }

  // 2. Cloudflare Turnstile
  const turnstileIframe = document.querySelector(
    'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], div.cf-turnstile, #turnstile-wrapper'
  );
  if (turnstileIframe) {
    return {
      detected: true,
      provider: 'cloudflare_turnstile',
      details: 'Widget Cloudflare Turnstile terdeteksi.',
    };
  }

  // 3. Google reCAPTCHA (v2 / v3 / Enterprise)
  const recaptcha = document.querySelector(
    'iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net/recaptcha"], iframe[title*="recaptcha"], div.g-recaptcha, #recaptcha'
  );
  if (recaptcha) {
    return {
      detected: true,
      provider: 'google_recaptcha',
      details: 'Widget Google reCAPTCHA terdeteksi.',
    };
  }

  // 4. hCaptcha
  const hcaptcha = document.querySelector(
    'iframe[src*="hcaptcha.com"], div.h-captcha, iframe[data-hcaptcha-widget-id]'
  );
  if (hcaptcha) {
    return {
      detected: true,
      provider: 'hcaptcha',
      details: 'Widget hCaptcha terdeteksi.',
    };
  }

  // 5. Arkose Labs / FunCAPTCHA
  const arkose = document.querySelector(
    'iframe[src*="arkoselabs.com"], iframe[src*="funcaptcha"], #fc-iframe-wrap'
  );
  if (arkose) {
    return {
      detected: true,
      provider: 'arkose_labs',
      details: 'Widget Arkose Labs / FunCAPTCHA terdeteksi.',
    };
  }

  return { detected: false };
}

export async function detectPageChallenge(contents: WebContents): Promise<ChallengeDetectionResult> {
  if (contents.isDestroyed() || contents.isCrashed()) {
    return { detected: false };
  }
  try {
    const result = await contents.executeJavaScript('(' + checkPageChallenge.toString() + ')()');
    return result as ChallengeDetectionResult;
  } catch {
    return { detected: false };
  }
}
