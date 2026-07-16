export const PORTAL_CATEGORY_KINDS = [
  "navigation",
  "tool",
  "server",
  "custom_page",
] as const;
export type PortalCategoryKind = (typeof PORTAL_CATEGORY_KINDS)[number];

export const PORTAL_VISIBILITIES = [
  "public",
  "authenticated",
  "role_restricted",
] as const;
export type PortalVisibility = (typeof PORTAL_VISIBILITIES)[number];

export const PORTAL_RECORD_STATUSES = ["active", "disabled"] as const;
export type PortalRecordStatus = (typeof PORTAL_RECORD_STATUSES)[number];

export interface PortalRoleSummary {
  code: string;
  name: string;
  level: number;
}

export interface PortalEntryResponse {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface PortalCategoryResponse {
  id: number;
  kind: PortalCategoryKind;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  status: PortalRecordStatus;
  entries: PortalEntryResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PortalContentResponse {
  categories: PortalCategoryResponse[];
}
