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
const NATIVE_PERM_CACHE_KEY = 'gb_admin_native_perm_v1';
const ANDROID_CHANNEL_ID = 'gb-admin-alerts';

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  enabled: true,
  orders: true,
  upi: true,
  products: true,
  payoutsAndWallets: true,
  helplineAndSos: true,
};

interface CapacitorLocalNotifPlugin {
  checkPermissions: () => Promise<{ display?: string }> | { display?: string };
  requestPermissions: () => Promise<{ display?: string }> | { display?: string };
  createChannel?: (opts: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
    visibility?: number;
    vibration?: boolean;
  }) => Promise<void> | void;
  schedule: (opts: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      channelId?: string;
      extra?: Record<string, string>;
    }>;
  }) => Promise<void> | void;
  addListener?: (
    eventName: string,
    cb: (action: {
      notification?: { extra?: { panel?: AdminPanelId; orderId?: string } };
    }) => void
  ) => unknown;
}

function getCapacitorLocalNotifications(): CapacitorLocalNotifPlugin | null {
  try {
    if (typeof window === 'undefined') return null;
    const cap = (
      window as unknown as {
        Capacitor?: {
          isNativePlatform?: () => boolean;
          Plugins?: { LocalNotifications?: CapacitorLocalNotifPlugin };
        };
      }
    ).Capacitor;

    if (cap?.isNativePlatform?.() && cap.Plugins?.LocalNotifications) {
      return cap.Plugins.LocalNotifications;
    }
    return null;
  } catch {
    return null;
  }
}

function mapCapacitorPerm(display?: string): NotificationPermission {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'default';
}

function readCachedNativePerm(): NotificationPermission {
  try {
    const val = localStorage.getItem(NATIVE_PERM_CACHE_KEY);
    if (val === 'granted' || val === 'denied' || val === 'default') {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return 'default';
}

function writeCachedNativePerm(perm: NotificationPermission): void {
  try {
    localStorage.setItem(NATIVE_PERM_CACHE_KEY, perm);
  } catch {
    // ignore storage errors
  }
}

let cachedNativePerm: NotificationPermission = readCachedNativePerm();
let channelReady = false;
let nativeBootstrapStarted = false;

async function ensureAndroidChannel(
  plugin: CapacitorLocalNotifPlugin
): Promise<void> {
  if (channelReady || !plugin.createChannel) return;
  try {
    await Promise.resolve(
      plugin.createChannel({
        id: ANDROID_CHANNEL_ID,
        name: 'Gossaigaon Bazar Admin Alerts',
        description: 'Live alerts for New Orders, UPI Proofs, SOS & Payouts',
        importance: 5,
        visibility: 1,
        vibration: true,
      })
    );
    channelReady = true;
  } catch {
    // ignore on unsupported platforms
  }
}

function bootstrapNativePush(): void {
  if (nativeBootstrapStarted) return;
  try {
    const nativePlugin = getCapacitorLocalNotifications();
    if (!nativePlugin) return;
    nativeBootstrapStarted = true;

    void ensureAndroidChannel(nativePlugin);

    try {
      void Promise.resolve(nativePlugin.checkPermissions())
        .then((res) => {
          cachedNativePerm = mapCapacitorPerm(res?.display);
          writeCachedNativePerm(cachedNativePerm);
        })
        .catch(() => {
          // ignore permission check failure
        });
    } catch {
      // ignore sync throw
    }

    if (nativePlugin.addListener) {
      try {
        const maybePromise = nativePlugin.addListener(
          'localNotificationActionPerformed',
          (action) => {
            const extra = action?.notification?.extra;
            if (extra?.panel) {
              window.dispatchEvent(
                new CustomEvent('gb-push-navigate', {
                  detail: { panel: extra.panel, orderId: extra.orderId || '' },
                })
              );
            }
          }
        );
        void Promise.resolve(maybePromise).catch(() => {
          // ignore listener failure
        });
      } catch {
        // ignore sync listener failure
      }
    }
  } catch {
    // never crash app startup
  }
}

bootstrapNativePush();

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

export function getNotificationPermissionState():
  | NotificationPermission
  | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';
  const nativePlugin = getCapacitorLocalNotifications();
  if (nativePlugin) {
    bootstrapNativePush();
    try {
      void Promise.resolve(nativePlugin.checkPermissions())
        .then((res) => {
          cachedNativePerm = mapCapacitorPerm(res?.display);
          writeCachedNativePerm(cachedNativePerm);
        })
        .catch(() => {});
    } catch {
      // ignore
    }
    return cachedNativePerm;
  }
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestPushPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  const nativePlugin = getCapacitorLocalNotifications();
  if (nativePlugin) {
    try {
      await ensureAndroidChannel(nativePlugin);
      const res = await Promise.resolve(nativePlugin.requestPermissions());
      cachedNativePerm = mapCapacitorPerm(res?.display);
      writeCachedNativePerm(cachedNativePerm);
      return cachedNativePerm;
    } catch {
      cachedNativePerm = 'denied';
      writeCachedNativePerm('denied');
      return 'denied';
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
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

export async function dispatchAdminPushNotification(
  opts: SendPushOptions
): Promise<boolean> {
  const nativePlugin = getCapacitorLocalNotifications();
  if (nativePlugin) {
    try {
      const perm = await Promise.resolve(nativePlugin.checkPermissions());
      const mapped = mapCapacitorPerm(perm?.display);
      cachedNativePerm = mapped;
      writeCachedNativePerm(mapped);
      if (mapped !== 'granted') return false;

      await ensureAndroidChannel(nativePlugin);
      await Promise.resolve(
        nativePlugin.schedule({
          notifications: [
            {
              id: Math.floor((Date.now() % 2000000000) + Math.random() * 1000),
              title: opts.title,
              body: opts.body,
              channelId: ANDROID_CHANNEL_ID,
              extra: {
                panel: opts.panel,
                orderId: opts.orderId || '',
              },
            },
          ],
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const notifOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = {
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
