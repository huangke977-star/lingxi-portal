import { requestJson, resolveApiUrl } from "./auth-api";

export interface AndroidRelease {
  id: number;
  versionName: string;
  versionCode: number;
  channel: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  apkUrl: string;
  releaseNotes: string[];
  isActive: boolean;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

export async function getLatestAndroidRelease(): Promise<AndroidRelease | null> {
  const response = await requestJson<{ release: AndroidRelease | null }>("/android-releases/latest", {
    cache: "no-store",
  });
  return response.release;
}

export async function listAndroidReleases(accessToken: string): Promise<AndroidRelease[]> {
  return requestJson<AndroidRelease[]>("/android-releases", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function uploadAndroidRelease(
  accessToken: string,
  input: {
    file: File;
    versionName: string;
    versionCode: number;
    channel: string;
    releaseNotes: string;
    activate: boolean;
  },
): Promise<AndroidRelease> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("versionName", input.versionName);
  body.append("versionCode", String(input.versionCode));
  body.append("channel", input.channel);
  body.append("releaseNotes", input.releaseNotes);
  body.append("activate", String(input.activate));

  return requestJson<AndroidRelease>("/android-releases", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
}

export async function activateAndroidRelease(accessToken: string, id: number): Promise<AndroidRelease> {
  return requestJson<AndroidRelease>(`/android-releases/${id}/activate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function deleteAndroidRelease(accessToken: string, id: number): Promise<void> {
  await requestJson<{ success: true }>(`/android-releases/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function resolveAndroidReleaseUrl(release: Pick<AndroidRelease, "apkUrl">): string {
  return resolveApiUrl(release.apkUrl);
}
