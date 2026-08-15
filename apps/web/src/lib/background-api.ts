import { requestJson, resolveApiUrl } from './auth-api';

export const BACKGROUND_CHANGE_EVENT = 'hlovet-background-change';
const BACKGROUND_CACHE_KEYS = ['hlovet.default-background.url', 'hlovet.active-background.url'] as const;

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

export function clearBackgroundCaches(): void {
  if (typeof window === 'undefined') {
    return;
  }

  for (const key of BACKGROUND_CACHE_KEYS) window.localStorage.removeItem(key);
}

export function notifyBackgroundChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BACKGROUND_CHANGE_EVENT));
  }
}
