import { api } from '@/lib/api';

/** Contract: apps/api/src/modules/providers (providers.controller, provider-setup.service). */
export type ProviderRow = { id: string; code: string; name: string; isActive: boolean; isHealthy: boolean; balance: string | number };

export type SupplierStatus = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  connected: boolean;
  /** Why the last check failed (null when connected). */
  problem?: {
    reason: 'invalid_token' | 'forbidden' | 'timeout' | 'unreachable' | 'supplier_error' | 'unexpected';
    code: string | null;
  } | null;
  balance: { balance: number; currency: string } | null;
  lowBalanceAlert: number | null;
  dailyLimit: number | null;
  spentToday: number;
  countryCode: string;
  linkedProducts: number;
};

export type CatalogOffer = {
  sku: string;
  productName: string;
  offerName: string;
  price: number;
  currency: string;
  inStock: boolean;
  needsPlayerId: boolean;
  needsServer: boolean;
  region?: string;
  countryCompatibility?: string;
  linkedProductId: string | null;
};

export type SupplierLink = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  sellPrice: number;
  sellCurrency: string;
  providerSku: string;
  providerCost: number;
  providerCurrency: string | null;
  margin: number | null;
  autoDelivery: boolean;
};

export type ProductHit = { id: string; sku: string; nameAr: string };

export const suppliers = {
  list: () => api.get<ProviderRow[]>('/admin/providers'),
  connect: (body: { code: 'gamesdrop'; apiKey: string; countryCode?: string; dailyLimit?: number; lowBalanceAlert?: number }) =>
    api.post<SupplierStatus>('/admin/providers/connect', body),
  status: (id: string) => api.get<SupplierStatus>(`/admin/providers/${id}/status`),
  limits: (id: string, body: { dailyLimit?: number; lowBalanceAlert?: number; isActive?: boolean }) =>
    api.patch<SupplierStatus>(`/admin/providers/${id}/limits`, body),
  catalog: (id: string, search: string, page = 1) =>
    api.get<{ total: number; offers: CatalogOffer[] }>(
      `/admin/providers/${id}/catalog?page=${page}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`,
    ),
  links: (id: string) => api.get<SupplierLink[]>(`/admin/providers/${id}/links`),
  link: (id: string, body: { productId: string; providerSku: string; providerCost: number }) =>
    api.post<SupplierLink>(`/admin/providers/${id}/links`, body),
  unlink: (linkId: string) => api.del<{ ok: true }>(`/admin/providers/links/${linkId}`),
  auto: (linkId: string, enabled: boolean) => api.post<{ id: string; autoDelivery: boolean }>(`/admin/providers/links/${linkId}/auto`, { enabled }),
  testOrder: (id: string) =>
    api.post<{ ok: boolean; status: string; providerRef?: string; error?: string; message?: string }>(`/admin/providers/${id}/test-order`),
  products: (q: string) =>
    api.get<{ data: ProductHit[] }>(`/admin/catalog/products?limit=8&search=${encodeURIComponent(q.trim())}`),
};

/** "1.50 USD" with Latin digits. */
export const money = (n: number | null | undefined, cur?: string | null) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}${cur ? ` ${cur}` : ''}`;
