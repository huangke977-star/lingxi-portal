import { requestJson, resolveApiUrl } from './auth-api';

export const BACKGROUND_CHANGE_EVENT = 'hlovet-background-change';
export const ACTIVE_BACKGROUND_CACHE_KEY = 'hlovet.active-background.url';

export interface ManagedBackground {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isActive: boolean;
  url: string;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

function authorizationHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function getActiveBackground(): Promise<ManagedBackground | null> {
  const response = await requestJson<{ background: ManagedBackground | null }>('/backgrounds/active', {
    cache: 'no-store',
  });
  return response.background;
}

export async function listBackgrounds(accessToken: string): Promise<ManagedBackground[]> {
  return requestJson<ManagedBackground[]>('/backgrounds', {
    cache: 'no-store',
    headers: authorizationHeader(accessToken),
  });
}

export async function uploadBackgrounds(accessToken: string, files: File[]): Promise<ManagedBackground[]> {
  const body = new FormData();
  for (const file of files) {
    body.append('files', file);
  }

  return requestJson<ManagedBackground[]>('/backgrounds', {
    method: 'POST',
    headers: authorizationHeader(accessToken),
    body,
  });
}

export async function activateBackground(accessToken: string, id: number): Promise<ManagedBackground> {
  return requestJson<ManagedBackground>(`/backgrounds/${id}/activate`, {
    method: 'PATCH',
    headers: authorizationHeader(accessToken),
  });
}

export async function clearActiveBackground(accessToken: string): Promise<void> {
  await requestJson<{ success: true }>('/backgrounds/active/clear', {
    method: 'PATCH',
    headers: authorizationHeader(accessToken),
  });
}

export async function deleteBackground(accessToken: string, id: number): Promise<void> {
  await requestJson<{ success: true }>(`/backgrounds/${id}`, {
    method: 'DELETE',
    headers: authorizationHeader(accessToken),
  });
}

export function resolveBackgroundUrl(background: Pick<ManagedBackground, 'url'>): string {
  return resolveApiUrl(background.url);
}

export function readCachedActiveBackgroundUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return normalizeBackgroundUrl(window.localStorage.getItem(ACTIVE_BACKGROUND_CACHE_KEY));
}

export function cacheActiveBackgroundUrl(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUrl = normalizeBackgroundUrl(url);
  if (!normalizedUrl) {
    clearActiveBackgroundCache();
    return;
  }

  window.localStorage.setItem(ACTIVE_BACKGROUND_CACHE_KEY, normalizedUrl);
}

export function clearActiveBackgroundCache(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACTIVE_BACKGROUND_CACHE_KEY);
}

export function notifyBackgroundChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BACKGROUND_CHANGE_EVENT));
  }
}

function normalizeBackgroundUrl(url: string | null): string | null {
  if (!url || typeof window === 'undefined') {
    return null;
  }

  try {
    const parsedUrl = new URL(url, window.location.origin);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : null;
  } catch {
    return null;
  }
}
