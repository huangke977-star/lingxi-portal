import { requestJson } from "./auth-api";
import type { ResourceDelivery, ResourceDeliveryPage } from "./discovery-api";

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export function listAdminResourceDeliveries(token: string, page = 1, pageSize = 50) {
  return requestJson<ResourceDeliveryPage>(`/resources/admin/deliveries?page=${page}&pageSize=${pageSize}`, { cache: "no-store", headers: authHeaders(token) });
}

export interface AdminPointAdjustment {
  id: number;
  user: { id: number; nickname: string; username: string };
  reason: "points_top_up" | "violation_penalty";
  eventKey: string;
  description: string;
  pointDelta: number;
  pointsAfter: number;
  createdAt: string;
}

export interface AdminPointAdjustmentPage {
  items: AdminPointAdjustment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function listAdminPointAdjustments(token: string, page = 1, pageSize = 50) {
  return requestJson<AdminPointAdjustmentPage>(`/resources/admin/points/adjustments?page=${page}&pageSize=${pageSize}`, { cache: "no-store", headers: authHeaders(token) });
}

export function markResourceDeliveryFailed(token: string, id: number, error: string) {
  return requestJson(`/resources/admin/deliveries/${id}/fail`, { method: "POST", headers: authHeaders(token), body: JSON.stringify({ error }) });
}

export function refundResourceDelivery(token: string, id: number) {
  return requestJson(`/resources/admin/deliveries/${id}/refund`, { method: "POST", headers: authHeaders(token) });
}

export function topUpUserPoints(token: string, input: { username: string; points: number; eventKey: string; note?: string }) {
  return requestJson<{ applied: boolean }>("/resources/admin/points/top-up", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) });
}

export function applyViolationPenalty(token: string, input: { username: string; points: number; eventKey: string; note?: string }) {
  return requestJson<{ applied: boolean }>("/resources/admin/points/violation", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) });
}

export interface CreatorResourceAggregate {
  articleId: number;
  article: { id: number; title: string; slug: string };
  blockKey: string;
  redemptionCount: number;
  grossPoints: number;
  pendingPoints: number;
  settledPoints: number;
  refundedPoints: number;
}

export interface CreatorResourceEarnings {
  summary: { total: number; pending: number; settled: number; refunded: number };
  aggregates: CreatorResourceAggregate[];
  items: ResourceDelivery[];
}

export function getCreatorResourceEarnings(token: string) {
  return requestJson<CreatorResourceEarnings>("/resources/creator/earnings", { cache: "no-store", headers: authHeaders(token) });
}

export type { ResourceDelivery };
