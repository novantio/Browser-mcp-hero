import type { WebContents } from 'electron';

export type ChallengeProvider =
  | 'cloudflare_turnstile'
  | 'google_recaptcha'
  | 'hcaptcha'
  | 'arkose_labs'
  | 'cloudflare_wait_screen'
  | 'tiktok_captcha'
  | 'geetest'
  | 'datadome'
  | 'aws_waf'
  | 'custom';

export interface ChallengeDetectionResult {
  detected: boolean;
  provider?: ChallengeProvider;
  details?: string;
  status?: 'human_required' | 'challenge_detected' | 'clean';
  taskId?: string;
  resumeToken?: string;
}

/**
 * Runs inside the browser page; serialized without module dependencies.
 * Analyzes the DOM, frames, and page indicators for known bot protection challenges.
 */
export function checkPageChallenge(): ChallengeDetectionResult {
  // Only challenges actually on screen count: sites leave a solved or closed CAPTCHA
  // container hidden in the DOM, which must not keep reporting "challenge".
  const isShown = (el: Element): boolean => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  };
  const findShown = (selector: string): Element | null => {
    for (const el of document.querySelectorAll(selector)) if (isShown(el)) return el;
    return null;
  };
  const title = (document.title || '').toLowerCase();
  const bodyText = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toLowerCase();

  // 1. TikTok / ByteDance SecSDK CAPTCHA (puzzle slider, rotate, select 2 objects)
  const tiktokCaptchaElem = findShown(
    '#captcha_container, #captcha-verify-image, #tiktok-verify-ele, ' +
    '.captcha_verify_container, .secsdk-captcha-drag-wrapper, .secsdk-captcha-container, ' +
    '.tiktok-verify-wrapper, .captcha-verify-container, .captcha_verify_slide, ' +
    '.captcha_verify_bar, .captcha_verify_img--wrapper, [class*="secsdk-captcha"], ' +
    '[class*="captcha-verify-container"]'
  );
  const tiktokIframe = findShown(
    'iframe[src*="security-captcha"], iframe[src*="captcha.tiktok.com"], ' +
    'iframe[src*="falcon/captcha_wrapper"], iframe[src*="bytedance.com/secsdk"]'
  );

  const hasTiktokChallengeText =
    (bodyText.includes('verify to continue') || bodyText.includes('verifikasi untuk melanjutkan')) ||
    (bodyText.includes('drag the slider') || bodyText.includes('tarik penggeser') || bodyText.includes('geser slider')) ||
    (bodyText.includes('select 2 objects that are the same shape') || bodyText.includes('pilih 2 objek berbentuk sama') || bodyText.includes('pilih 2 objek')) ||
    (bodyText.includes('rotate the shapes') || bodyText.includes('putar bentuk') || bodyText.includes('putar gambar')) ||
    (bodyText.includes('fit the puzzle') || bodyText.includes('lengkapi teka-teki'));

  const isTiktokHost = window.location.hostname.includes('tiktok.com');

  if (tiktokCaptchaElem || tiktokIframe || (isTiktokHost && hasTiktokChallengeText)) {
    return {
      detected: true,
      provider: 'tiktok_captcha',
      details: 'TikTok / ByteDance SecSDK CAPTCHA terdeteksi (puzzle slider, 2 objek serupa, atau rotasi gambar).',
    };
  }

  // 2. Cloudflare Wait Screen / Challenge Page
  if (
    title.includes('just a moment...') ||
    title.includes('attention required! | cloudflare') ||
    findShown('#challenge-running, #challenge-stage, #cf-challenge-running, #challenge-body-text') ||
    (bodyText.includes('checking your browser before accessing') && bodyText.includes('cloudflare'))
  ) {
    return {
      detected: true,
      provider: 'cloudflare_wait_screen',
      details: 'Cloudflare bot verification / wait screen terdeteksi di halaman.',
    };
  }

  // 3. Cloudflare Turnstile
  const turnstileIframe = findShown(
    'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], div.cf-turnstile, #turnstile-wrapper'
  );
  if (turnstileIframe) {
    return {
      detected: true,
      provider: 'cloudflare_turnstile',
      details: 'Widget Cloudflare Turnstile terdeteksi.',
    };
  }

  // 4. Google reCAPTCHA (v2 / v3 / Enterprise)
  const recaptcha = findShown(
    'iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net/recaptcha"], iframe[title*="recaptcha"], div.g-recaptcha, #recaptcha'
  );
  if (recaptcha) {
    return {
      detected: true,
      provider: 'google_recaptcha',
      details: 'Widget Google reCAPTCHA terdeteksi.',
    };
  }

  // 5. hCaptcha
  const hcaptcha = findShown(
    'iframe[src*="hcaptcha.com"], div.h-captcha, iframe[data-hcaptcha-widget-id]'
  );
  if (hcaptcha) {
    return {
      detected: true,
      provider: 'hcaptcha',
      details: 'Widget hCaptcha terdeteksi.',
    };
  }

  // 6. Arkose Labs / FunCAPTCHA
  const arkose = findShown(
    'iframe[src*="arkoselabs.com"], iframe[src*="funcaptcha"], #fc-iframe-wrap'
  );
  if (arkose) {
    return {
      detected: true,
      provider: 'arkose_labs',
      details: 'Widget Arkose Labs / FunCAPTCHA terdeteksi.',
    };
  }

  // 7. Geetest CAPTCHA
  const geetest = findShown(
    '.geetest_holder, .geetest_wind, .geetest_radar, .geetest_popup, .geetest_panel'
  );
  if (geetest) {
    return {
      detected: true,
      provider: 'geetest',
      details: 'Widget Geetest CAPTCHA terdeteksi.',
    };
  }

  // 8. DataDome
  const datadome = findShown(
    'iframe[src*="datadome.co"], iframe[src*="captcha-delivery.com"]'
  );
  if (datadome || title.includes('datadome')) {
    return {
      detected: true,
      provider: 'datadome',
      details: 'DataDome bot protection challenge terdeteksi.',
    };
  }

  // 9. AWS WAF CAPTCHA
  const awswaf = findShown('#aws-waf-captcha, iframe[src*="awswaf"]');
  if (awswaf || (bodyText.includes('aws waf') && bodyText.includes('captcha'))) {
    return {
      detected: true,
      provider: 'aws_waf',
      details: 'AWS WAF CAPTCHA terdeteksi.',
    };
  }

  return { detected: false };
}

export async function detectPageChallenge(contents: WebContents): Promise<ChallengeDetectionResult> {
  if (contents.isDestroyed() || contents.isCrashed()) {
    return { detected: false };
  }
  try {
    // A busy page must not stall every observe/act call behind challenge detection.
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      contents.executeJavaScript('(' + checkPageChallenge.toString() + ')()'),
      new Promise<ChallengeDetectionResult>(resolve => { timer = setTimeout(() => resolve({ detected: false }), 3000); }),
    ]).finally(() => clearTimeout(timer));
    return result as ChallengeDetectionResult;
  } catch {
    return { detected: false };
  }
}
