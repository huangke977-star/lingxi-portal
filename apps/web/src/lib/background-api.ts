import { requestJson, resolveApiUrl } from './auth-api';

export const BACKGROUND_CHANGE_EVENT = 'hlovet-background-change';

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

export async function uploadBackground(accessToken: string, file: File): Promise<ManagedBackground> {
  const body = new FormData();
  body.append('file', file);

  return requestJson<ManagedBackground>('/backgrounds', {
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

export async function deleteBackground(accessToken: string, id: number): Promise<void> {
  await requestJson<{ success: true }>(`/backgrounds/${id}`, {
    method: 'DELETE',
    headers: authorizationHeader(accessToken),
  });
}

export function resolveBackgroundUrl(background: Pick<ManagedBackground, 'url'>): string {
  return resolveApiUrl(background.url);
}

export function notifyBackgroundChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BACKGROUND_CHANGE_EVENT));
  }
}
