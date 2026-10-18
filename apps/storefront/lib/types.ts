/** Shared storefront types, mapped to the public API contract (/api/v1). */

export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
};

export type Cursored<T> = {
  data: T[];
  meta: { hasMore: boolean; nextCursor: string | null; limit: number };
};

export type Currency = {
  code: string;
  symbol: string;
  decimals: number;
  sortOrder?: number;
};

export type Category = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  children?: Category[];
};

export type GameInput = {
  key: string;
  labelAr: string;
  labelEn: string;
  type: string;
  required?: boolean;
  regex?: string;
  sensitive?: boolean;
};

export type Game = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  description?: string | null;
  coverUrl?: string | null;
  logoUrl?: string | null;
  publisher?: string | null;
  inputSchema?: GameInput[];
  isFeatured?: boolean;
  sortOrder?: number;
  category?: Pick<Category, 'id' | 'slug' | 'nameAr' | 'nameEn'>;
  _count?: { products?: number };
};

export type Product = {
  id: string;
  sku: string;
  type: string;
  delivery: string;
  nameAr: string;
  nameEn: string;
  description?: string | null;
  imageUrl?: string | null;
  categoryId?: string | null;
  gameId?: string | null;
  stockQty?: number | null;
  maxPerOrder?: number | null;
  metadata?: Record<string, unknown> | null;
  isActive?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
  category?: Pick<Category, 'id' | 'slug' | 'nameAr' | 'nameEn'>;
  game?: Pick<Game, 'id' | 'slug' | 'nameAr' | 'nameEn' | 'inputSchema'>;
  sellPrice: string; // what the customer pays (after the owner's discount)
  listPrice?: string; // before the discount; equals sellPrice when there is none
  discountPercent?: number;
  currency: string;
  priceIsOverride?: boolean;
  inStock?: boolean;
};

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

export type Me = {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  locale?: string;
  defaultCurrency?: string;
  wallets?: { currencyCode: string; balance: string }[];
  roles?: string[];
};

export type QuoteItem = {
  productId: string;
  productNameAr: string;
  productNameEn: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  inputs?: { fieldKey: string; fieldLabel: string; value: string; isSensitive?: boolean }[];
};

export type Quote = {
  id: string;
  quoteNumber: string;
  status: string;
  subtotal: string;
  discount: string;
  fees: string;
  taxAmount: string;
  total: string;
  currency: string;
  couponId?: string | null;
  expiresAt: string;
  items: QuoteItem[];
  secondsRemaining: number;
  isExpired: boolean;
};

export type Order = {
  id: string;
  orderNumber: string;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
  paidAt?: string | null;
  completedAt?: string | null;
  items: {
    id: string;
    productNameAr: string;
    productNameEn: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    status: string;
    results?: { id: string; resultType: string; hasValue: boolean; revealed: boolean; deliveredAt?: string | null }[];
  }[];
  payments?: { id: string; gateway: string; status: string; amount: string; createdAt: string }[];
};
