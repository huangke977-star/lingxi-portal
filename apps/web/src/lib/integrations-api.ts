import { authHeaders, requestJson } from "./auth-api";

export type ReadOnlyScope = "read_articles" | "read_profile" | "read_notifications";
export interface ReadOnlyToken { id: number; name: string; tokenPrefix: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; }
export interface WebhookEndpoint { id: number; name: string; url: string; events: string[]; enabled: boolean; deliveryCount: number; lastDeliveredAt: string | null; lastError: string | null; createdAt: string; updatedAt: string; }
export interface ExternalChannel { id: number; kind: string; endpoint: string; preferences: Record<string, boolean>; enabled: boolean; verified: boolean; failureCount: number; lastError: string | null; lastDeliveredAt: string | null; createdAt: string; }

export function listReadOnlyTokens(token: string) { return requestJson<ReadOnlyToken[]>("/integrations/tokens", { headers: authHeaders(token), cache: "no-store" }); }
export function createReadOnlyToken(token: string, input: { name: string; scopes: ReadOnlyScope[]; expiresAt?: string }) { return requestJson<ReadOnlyToken & { token: string }>("/integrations/tokens", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) }); }
export function revokeReadOnlyToken(token: string, id: number) { return requestJson<{ success: true }>(`/integrations/tokens/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export function listExternalChannels(token: string) { return requestJson<ExternalChannel[]>("/integrations/external-channels", { headers: authHeaders(token), cache: "no-store" }); }
export function createExternalChannel(token: string, input: { kind: "webhook"; endpoint: string; secret?: string }) { return requestJson<ExternalChannel & { verificationRequired: true; verificationExpiresAt: string }>("/integrations/external-channels", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) }); }
export function verifyExternalChannel(token: string, id: number, code: string) { return requestJson<ExternalChannel>(`/integrations/external-channels/${id}/verify`, { method: "POST", headers: authHeaders(token), body: JSON.stringify({ code }) }); }
export function updateExternalChannel(token: string, id: number, input: { enabled?: boolean }) { return requestJson<ExternalChannel>(`/integrations/external-channels/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(input) }); }
export function deleteExternalChannel(token: string, id: number) { return requestJson<{ success: true }>(`/integrations/external-channels/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export function listAdminWebhooks(token: string) { return requestJson<WebhookEndpoint[]>("/integrations/admin/webhooks", { headers: authHeaders(token), cache: "no-store" }); }
export function createAdminWebhook(token: string, input: { name: string; url: string; secret: string; events: string[] }) { return requestJson<WebhookEndpoint & { secretConfigured: true }>("/integrations/admin/webhooks", { method: "POST", headers: authHeaders(token), body: JSON.stringify(input) }); }
export function updateAdminWebhook(token: string, id: number, input: { enabled?: boolean }) { return requestJson<WebhookEndpoint>(`/integrations/admin/webhooks/${id}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(input) }); }
export function deleteAdminWebhook(token: string, id: number) { return requestJson<{ success: true }>(`/integrations/admin/webhooks/${id}`, { method: "DELETE", headers: authHeaders(token) }); }
export function testAdminWebhook(token: string) { return requestJson<void>("/integrations/admin/webhooks/test", { method: "POST", headers: authHeaders(token) }); }
export function listAdminWebhookDeliveries(token: string) { return requestJson<Array<{ id: number; endpointId: number; eventId: string; eventType: string; status: string; attempts: number; lastError: string | null; createdAt: string }>>("/integrations/admin/webhook-deliveries", { headers: authHeaders(token), cache: "no-store" }); }
export function replayAdminWebhookDelivery(token: string, id: number) { return requestJson<void>(`/integrations/admin/webhook-deliveries/${id}/replay`, { method: "POST", headers: authHeaders(token) }); }
