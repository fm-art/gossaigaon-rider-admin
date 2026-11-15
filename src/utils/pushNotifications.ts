import { AdminPanelId } from '../types';

export interface PushPrefs {
  enabled: boolean;
  orders: boolean;
  upi: boolean;
  products: boolean;
  payoutsAndWallets: boolean;
  helplineAndSos: boolean;
}

const PREFS_KEY = 'gb_admin_push_prefs_v1';

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  enabled: true,
  orders: true,
  upi: true,
  products: true,
  payoutsAndWallets: true,
  helplineAndSos: true,
};

export function loadPushPrefs(): PushPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PUSH_PREFS;
    return { ...DEFAULT_PUSH_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PUSH_PREFS;
  }
}

export function savePushPrefs(prefs: PushPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage quota errors
  }
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export interface SendPushOptions {
  title: string;
  body: string;
  panel: AdminPanelId;
  orderId?: string;
  tag?: string;
  requireInteraction?: boolean;
}

export async function dispatchAdminPushNotification(opts: SendPushOptions): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const notifOptions: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: opts.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: opts.tag || `gb-${opts.panel}-${opts.orderId || Date.now()}`,
    renotify: true,
    requireInteraction: Boolean(opts.requireInteraction),
    vibrate: [200, 100, 200],
    data: {
      url: '/',
      panel: opts.panel,
      orderId: opts.orderId || '',
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(opts.title, notifOptions);
        return true;
      }
    }
    const n = new Notification(opts.title, notifOptions);
    n.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent('gb-push-navigate', {
          detail: { panel: opts.panel, orderId: opts.orderId || '' },
        })
      );
      n.close();
    };
    return true;
  } catch {
    try {
      const n = new Notification(opts.title, notifOptions);
      n.onclick = () => {
        window.focus();
        n.close();
      };
      return true;
    } catch {
      return false;
    }
  }
}
