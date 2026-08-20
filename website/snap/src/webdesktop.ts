import { useCallback, useEffect, useState } from 'react';

type BridgeMessage = {
  type?: string;
  installed?: unknown;
  installing?: unknown;
  canInstall?: unknown;
  name?: unknown;
  progress?: unknown;
  message?: unknown;
};

export interface WebDesktopBridge {
  connected: boolean;
  canInstall: boolean;
  installed: ReadonlySet<string>;
  installing: Readonly<Record<string, number>>;
  error: string | null;
  install: (name: string, channel?: string, confinement?: string) => void;
  open: (name: string) => void;
}

function normalizedProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseInstalling(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, number> = {};
  for (const [name, progress] of Object.entries(value)) {
    if (name) parsed[name] = normalizedProgress(progress);
  }
  return parsed;
}

export function useWebDesktopBridge(): WebDesktopBridge {
  const [connected, setConnected] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState<ReadonlySet<string>>(() => new Set());
  const [installing, setInstalling] = useState<Readonly<Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.parent === window) return;

    const receive = (event: MessageEvent<BridgeMessage>) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
      const message = event.data;
      if (message.type === 'capos-webdesktop:state') {
        const names = Array.isArray(message.installed)
          ? message.installed.filter((name): name is string => typeof name === 'string' && name.length > 0)
          : [];
        setConnected(true);
        setCanInstall(message.canInstall === true);
        setInstalled(new Set(names));
        setInstalling(parseInstalling(message.installing));
        setError(null);
        return;
      }
      if (message.type === 'capos-webdesktop:progress' && typeof message.name === 'string') {
        setConnected(true);
        setInstalling(current => ({ ...current, [message.name as string]: normalizedProgress(message.progress) }));
        return;
      }
      if (message.type === 'capos-webdesktop:error') {
        setConnected(true);
        if (typeof message.name === 'string') {
          setInstalling(current => {
            const next = { ...current };
            delete next[message.name as string];
            return next;
          });
        }
        setError(typeof message.message === 'string' ? message.message : 'WebDesktop operation failed.');
      }
    };

    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'capos-store:hello', version: 1 }, '*');
    const retry = window.setTimeout(() => {
      window.parent.postMessage({ type: 'capos-store:hello', version: 1 }, '*');
    }, 1200);
    return () => {
      window.removeEventListener('message', receive);
      window.clearTimeout(retry);
    };
  }, []);

  const install = useCallback((name: string, channel = 'stable', confinement?: string) => {
    setError(null);
    window.parent.postMessage({ type: 'capos-store:install', version: 1, name, channel, confinement }, '*');
  }, []);

  const open = useCallback((name: string) => {
    setError(null);
    window.parent.postMessage({ type: 'capos-store:open', version: 1, name }, '*');
  }, []);

  return { connected, canInstall, installed, installing, error, install, open };
}
