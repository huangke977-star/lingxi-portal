import { requestJson } from "./auth-api";
import type { ResourceDelivery, ResourceDeliveryPage } from "./discovery-api";

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export function listAdminResourceDeliveries(token: string, page = 1, pageSize = 50) {
  return requestJson<ResourceDeliveryPage>(`/resources/admin/deliveries?page=${page}&pageSize=${pageSize}`, { cache: "no-store", headers: authHeaders(token) });
}

export function markResourceDeliveryFailed(token: string, id: number, error: string) {
  return requestJson(`/resources/admin/deliveries/${id}/fail`, { method: "POST", headers: authHeaders(token), body: JSON.stringify({ error }) });
}

export function refundResourceDelivery(token: string, id: number) {
  return requestJson(`/resources/admin/deliveries/${id}/refund`, { method: "POST", headers: authHeaders(token) });
}

export function topUpUserPoints(token: string, input: { userId: number; points: number; eventKey: string; note?: string }) {
  return requestJson<{ applied: boolean }>("/resources/admin/points/top-up", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) });
}

export function applyViolationPenalty(token: string, input: { userId: number; points: number; eventKey: string; note?: string }) {
  return requestJson<{ applied: boolean }>("/resources/admin/points/violation", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) });
}

export type { ResourceDelivery };
