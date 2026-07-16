import { requestJson } from "./auth-api";

export const PORTAL_CATEGORY_KINDS = [
  "navigation",
  "tool",
  "server",
  "custom_page",
] as const;
export type PortalCategoryKind = (typeof PORTAL_CATEGORY_KINDS)[number];

export type PortalVisibility = "public" | "authenticated" | "role_restricted";
export type PortalRecordStatus = "active" | "disabled";

export interface PortalRoleSummary {
  code: string;
  name: string;
  level: number;
}

export interface PortalEntry {
  id: number;
  categoryId: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  visibility: PortalVisibility;
  sortOrder: number;
  status: PortalRecordStatus;
  allowedRoles: PortalRoleSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface PortalCategory {
  id: number;
  kind: PortalCategoryKind;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  status: PortalRecordStatus;
  entries: PortalEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PortalContent {
  categories: PortalCategory[];
}

export interface PortalCategoryInput {
  kind: PortalCategoryKind;
  name: string;
  description: string;
  sortOrder: number;
  status: PortalRecordStatus;
}

export interface PortalEntryInput {
  categoryId: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  visibility: PortalVisibility;
  sortOrder: number;
  status: PortalRecordStatus;
  roleCodes: string[];
}

function authorizationHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function kindsQuery(kinds: PortalCategoryKind[]): string {
  const searchParams = new URLSearchParams();
  if (kinds.length) {
    searchParams.set("kinds", kinds.join(","));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function listPortalContent(
  kinds: PortalCategoryKind[],
  accessToken?: string | null,
): Promise<PortalContent> {
  const path = accessToken ? "/portal/me" : "/portal/public";
  return requestJson<PortalContent>(`${path}${kindsQuery(kinds)}`, {
    cache: "no-store",
    headers: accessToken ? authorizationHeader(accessToken) : undefined,
  });
}

export async function listPortalAdminContent(
  accessToken: string,
): Promise<PortalContent> {
  return requestJson<PortalContent>("/portal/admin", {
    cache: "no-store",
    headers: authorizationHeader(accessToken),
  });
}

export async function createPortalCategory(
  accessToken: string,
  input: PortalCategoryInput,
): Promise<PortalCategory> {
  return requestJson<PortalCategory>("/portal/admin/categories", {
    method: "POST",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify(input),
  });
}

export async function updatePortalCategory(
  accessToken: string,
  categoryId: number,
  input: PortalCategoryInput,
): Promise<PortalCategory> {
  return requestJson<PortalCategory>(`/portal/admin/categories/${categoryId}`, {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify(input),
  });
}

export async function deletePortalCategory(
  accessToken: string,
  categoryId: number,
): Promise<void> {
  await requestJson<{ success: true }>(
    `/portal/admin/categories/${categoryId}`,
    {
      method: "DELETE",
      headers: authorizationHeader(accessToken),
    },
  );
}

export async function createPortalEntry(
  accessToken: string,
  input: PortalEntryInput,
): Promise<PortalEntry> {
  return requestJson<PortalEntry>("/portal/admin/entries", {
    method: "POST",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify(input),
  });
}

export async function updatePortalEntry(
  accessToken: string,
  entryId: number,
  input: PortalEntryInput,
): Promise<PortalEntry> {
  return requestJson<PortalEntry>(`/portal/admin/entries/${entryId}`, {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify(input),
  });
}

export async function deletePortalEntry(
  accessToken: string,
  entryId: number,
): Promise<void> {
  await requestJson<{ success: true }>(`/portal/admin/entries/${entryId}`, {
    method: "DELETE",
    headers: authorizationHeader(accessToken),
  });
}

export function portalEntryMarker(title: string): string {
  const characters = Array.from(title.trim());
  return characters.slice(0, Math.min(2, characters.length)).join("") || "H";
}
