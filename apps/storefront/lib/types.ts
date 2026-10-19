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
  /** How the customer finds this value (e.g. where the Player ID is in the game). */
  helpAr?: string;
  helpFr?: string;
  helpEn?: string;
  /** A fixed choice instead of free text (e.g. the network a wallet address is on). */
  options?: { value: string; labelAr: string; labelEn: string }[];
};

/** A text in the store's three languages; French and English may be missing (Arabic shows). */
export type Localized = { ar: string; fr?: string; en?: string };

/** What the customer should know about a product: before buying, after delivery, and the one costly mistake. */
export type ProductGuide = {
  before?: Localized[];
  after?: Localized[];
  warning?: Localized;
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
  email: string | null; // null for accounts made with a WhatsApp number
  fullName: string;
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  avatarUrl?: string | null;
  locale?: string;
  defaultCurrency?: string;
  wallets?: { currencyCode: string; balance: string }[];
  roles?: string[];
  /** Where the customer lives: ISO country and the city they typed. */
  country?: string | null;
  city?: string | null;
};

// ─── the 50 additions (docs/api-contract-50.md) ───

export type SavedInput = { id: string; gameId: string; label: string | null; values: Record<string, string>; updatedAt: string };

export type PriceWatch = {
  id: string;
  productId: string;
  kind: 'price' | 'stock';
  priceAtWatch: string;
  notifiedAt: string | null;
  createdAt: string;
  product: { id: string; sku: string; nameAr: string; nameEn: string; gameId: string | null };
};

export type AppNotification = {
  id: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  data: { type?: string; orderId?: string; productId?: string; link?: string; fr?: { title: string; body: string } } | null;
  isRead: boolean;
  createdAt: string;
};

export type MyCode = {
  orderId: string;
  orderNumber: string;
  itemId: string;
  productId: string;
  productNameAr: string;
  productNameEn: string;
  quantity: number;
  deliveredAt: string | null;
  results: { id: string; resultType: string; revealed: boolean }[];
};

export type ReviewSummary = {
  average: number | null;
  count: number;
  items: { id: string; rating: number; comment: string | null; author: string; createdAt: string; reply: string | null }[];
};

export type SupportTicket = {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  subject: string;
  message: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

export type BestSeller = { productId: string; sku: string; gameId: string | null; units: number };
export type StoreStats = { ordersDelivered: number; customers: number };
export type Rates = { base: string; rates: Record<string, number> };

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
    productId: string;
    productNameAr: string;
    productNameEn: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    status: string;
    /** How to use what was bought (redeem the card, where the coins appear…). */
    guide?: ProductGuide | null;
    /** What the customer entered (e.g. the player ID); sensitive values come back as "••••". */
    inputs?: { fieldKey: string; fieldLabel: string; value: string }[];
    results?: { id: string; resultType: string; hasValue: boolean; revealed: boolean; deliveredAt?: string | null }[];
  }[];
  payments?: { id: string; gateway: string; status: string; amount: string; failureReason?: string | null; createdAt: string }[];
};

/** An offer the owner pins to the top of the home page. */
export type Banner = {
  id: string;
  titleAr: string;
  /** The owner's English title, shown in French and English when set. */
  titleEn?: string | null;
  subtitleAr: string | null;
  imageUrl: string | null;
  tone: 'teal' | 'gold' | 'ink' | 'rose';
  linkType: 'product' | 'offers' | 'url' | null;
  linkValue: string | null;
};

export type ManualAccount = {
  id: string;
  method: string;
  /** ISO codes it is offered in; "XX" = every other country; empty = everywhere. */
  countries: string[];
  accountName: string;
  accountNumber: string;
  kind: 'mobile' | 'bank' | 'crypto';
  logo?: string;
  instructions?: string;
};
