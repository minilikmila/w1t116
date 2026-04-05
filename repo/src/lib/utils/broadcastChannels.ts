import type { DataSyncMessage, AuthSyncMessage, SchedulerSyncMessage, RegistrationSyncMessage, FlagSyncMessage } from '../types';

export const CHANNELS = {
  DATA_SYNC: 'data-sync',
  AUTH_SYNC: 'auth-sync',
  SCHEDULER_SYNC: 'scheduler-sync',
  REGISTRATION_SYNC: 'registration-sync',
  FLAG_SYNC: 'flag-sync',
} as const;

type ChannelMessageMap = {
  'data-sync': DataSyncMessage;
  'auth-sync': AuthSyncMessage;
  'scheduler-sync': SchedulerSyncMessage;
  'registration-sync': RegistrationSyncMessage;
  'flag-sync': FlagSyncMessage;
};

const channels = new Map<string, BroadcastChannel>();
let warnedUnsupported = false;

function isSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function warnOnce(): void {
  if (!warnedUnsupported) {
    warnedUnsupported = true;
    console.warn('BroadcastChannel is not supported in this environment. Cross-tab communication is disabled.');
  }
}

function getOrCreateChannel(name: string): BroadcastChannel {
  let channel = channels.get(name);
  if (!channel) {
    channel = new BroadcastChannel(name);
    channels.set(name, channel);
  }
  return channel;
}

function broadcast<K extends keyof ChannelMessageMap>(channelName: K, message: ChannelMessageMap[K]): void {
  if (!isSupported()) {
    warnOnce();
    return;
  }
  const channel = getOrCreateChannel(channelName);
  channel.postMessage(message);
}

function onMessage<K extends keyof ChannelMessageMap>(
  channelName: K,
  handler: (message: ChannelMessageMap[K]) => void,
): () => void {
  if (!isSupported()) {
    warnOnce();
    return () => {};
  }
  const channel = getOrCreateChannel(channelName);
  const listener = (event: MessageEvent<ChannelMessageMap[K]>) => {
    handler(event.data);
  };
  channel.addEventListener('message', listener);
  return () => {
    channel.removeEventListener('message', listener);
  };
}

function closeAll(): void {
  for (const channel of channels.values()) {
    channel.close();
  }
  channels.clear();
}

export const channelManager = { broadcast, onMessage, closeAll };
export default channelManager;
