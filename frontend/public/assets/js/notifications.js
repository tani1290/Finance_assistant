/**
 * FinPro — Audio & Notification Engine
 * FinPro — Personal Finance & Investment Decision Support Platform
 * Pure Vanilla JS Web Audio API synthesizer & HTML5 Notification Handler
 */

let audioCtx = null;

const getAudioContext = () => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

/**
 * Play a synthesized dual-tone harmonic audio chime without external mp3 files
 * Types: 'success' | 'alert' | 'pop' | 'bell'
 */
export const playAudioChime = (type = 'success') => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success' || type === 'bell') {
      // Pleasant upward financial chime (C5 -> E5 -> G5)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'alert' || type === 'error') {
      // Warning chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now); // A4
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.15); // E4
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else {
      // Soft click/pop
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }
    return true;
  } catch (err) {
    console.warn('[Audio] Could not play audio chime:', err.message);
    return false;
  }
};

/**
 * Request real browser notification permission
 * Returns: 'granted' | 'denied' | 'default' | 'unsupported'
 */
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  if (Notification.permission === 'denied') {
    return 'denied';
  }
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (err) {
    console.warn('[Notification] Permission request failed:', err.message);
    return Notification.permission || 'denied';
  }
};

/**
 * Trigger notification with audio and graceful fallback
 */
export const triggerNotification = async ({ title, message, type = 'info', playSound = true }) => {
  if (playSound) {
    playAudioChime(type === 'error' ? 'alert' : 'success');
  }

  // If permission is granted, send native browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title || 'FinPro Notification', {
        body: message,
        icon: '/assets/icons/icon-192.png',
      });
      return { shown: true, method: 'native' };
    } catch (err) {
      console.warn('[Notification] Native notification dispatch error:', err.message);
    }
  }

  // Graceful in-app fallback
  showInAppBanner(title, message, type);
  return { shown: true, method: 'in-app' };
};

/**
 * Display premium in-app glassmorphism banner
 */
const showInAppBanner = (title, message, type = 'info') => {
  const existing = document.getElementById('finpro-notif-banner');
  if (existing) existing.remove();

  const b = document.createElement('div');
  b.id = 'finpro-notif-banner';
  b.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    background: var(--surface);
    backdrop-filter: blur(12px);
    border: 1px solid ${type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--info)'};
    border-radius: 12px;
    padding: 14px 20px;
    color: var(--text);
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    z-index: 10000;
    box-shadow: var(--shadow-xl);
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: finproSlideIn 0.3s ease;
  `;
  b.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <div style="font-weight:700;color:${type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--info)'};display:flex;align-items:center;gap:6px;">
        <i class="ri-${type === 'error' ? 'alarm-warning-line' : type === 'success' ? 'checkbox-circle-line' : 'notification-3-line'}"></i>
        ${title || 'FinPro Alert'}
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;">✕</button>
    </div>
    <div style="color:var(--text-secondary);line-height:1.4;">${message}</div>
  `;

  document.body.appendChild(b);
  setTimeout(() => { if (b.parentNode) b.remove(); }, 5000);
};

// Global attachment for standard script tags
if (typeof window !== 'undefined') {
  window.finproAudio = {
    playAudioChime,
    requestNotificationPermission,
    triggerNotification,
  };
}
