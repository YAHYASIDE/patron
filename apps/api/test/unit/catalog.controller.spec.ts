import { CatalogAdminController, CatalogPublicController } from '../../src/modules/catalog/catalog.controller';

describe('CatalogPublicController', () => {
  let categories: any;
  let games: any;
  let products: any;
  let pricing: any;
  let controller: CatalogPublicController;

  beforeEach(() => {
    categories = { findTree: jest.fn().mockReturnValue('tree'), findOne: jest.fn().mockReturnValue('cat') };
    games = { findAll: jest.fn().mockReturnValue('games'), findOne: jest.fn().mockReturnValue('game') };
    products = { findAllPublic: jest.fn().mockReturnValue('products'), findOnePublic: jest.fn().mockReturnValue('product') };
    pricing = { listCurrencies: jest.fn().mockReturnValue('currencies') };
    controller = new CatalogPublicController(categories, games, products, pricing);
  });

  it('lists currencies', () => {
    expect(controller.currencies()).toBe('currencies');
    expect(pricing.listCurrencies).toHaveBeenCalled();
  });

  it('returns the category tree', () => {
    expect(controller.categoryTree()).toBe('tree');
    expect(categories.findTree).toHaveBeenCalled();
  });

  it('resolves a single category by id or slug', () => {
    expect(controller.category('games')).toBe('cat');
    expect(categories.findOne).toHaveBeenCalledWith('games');
  });

  it('lists games with the query', () => {
    const q = { page: 1 } as any;
    expect(controller.gameList(q)).toBe('games');
    expect(games.findAll).toHaveBeenCalledWith(q);
  });

  it('resolves a single game', () => {
    expect(controller.game('valorant')).toBe('game');
    expect(games.findOne).toHaveBeenCalledWith('valorant');
  });

  it('lists products (public, priced) with the query', () => {
    const q = { currency: 'EUR' } as any;
    expect(controller.productList(q)).toBe('products');
    expect(products.findAllPublic).toHaveBeenCalledWith(q);
  });

  it('resolves a single product with an optional currency', () => {
    expect(controller.product('SKU1', 'EUR')).toBe('product');
    expect(products.findOnePublic).toHaveBeenCalledWith('SKU1', 'EUR');
  });

  it('resolves a single product without a currency', () => {
    void controller.product('SKU1');
    expect(products.findOnePublic).toHaveBeenCalledWith('SKU1', undefined);
  });
});

describe('CatalogAdminController', () => {
  let categories: any;
  let games: any;
  let products: any;
  let controller: CatalogAdminController;

  beforeEach(() => {
    categories = {
      findAll: jest.fn().mockReturnValue('cats'),
      create: jest.fn().mockReturnValue('c-created'),
      update: jest.fn().mockReturnValue('c-updated'),
      remove: jest.fn().mockReturnValue('c-removed'),
    };
    games = {
      findAll: jest.fn().mockReturnValue('games'),
      create: jest.fn().mockReturnValue('g-created'),
      update: jest.fn().mockReturnValue('g-updated'),
      remove: jest.fn().mockReturnValue('g-removed'),
    };
    products = {
      findAllAdmin: jest.fn().mockReturnValue('prods'),
      create: jest.fn().mockReturnValue('p-created'),
      update: jest.fn().mockReturnValue('p-updated'),
      remove: jest.fn().mockReturnValue('p-removed'),
    };
    controller = new CatalogAdminController(categories, games, products);
  });

  describe('categories', () => {
    it('lists all (including inactive)', () => {
      expect(controller.listCategories()).toBe('cats');
      expect(categories.findAll).toHaveBeenCalled();
    });
    it('creates', () => {
      const dto = { slug: 'x' } as any;
      expect(controller.createCategory(dto, 'admin1')).toBe('c-created');
      expect(categories.create).toHaveBeenCalledWith(dto, 'admin1');
    });
    it('updates', () => {
      const dto = { nameEn: 'X' } as any;
      expect(controller.updateCategory('c1', dto, 'admin1')).toBe('c-updated');
      expect(categories.update).toHaveBeenCalledWith('c1', dto, 'admin1');
    });
    it('removes', () => {
      expect(controller.removeCategory('c1', 'admin1')).toBe('c-removed');
      expect(categories.remove).toHaveBeenCalledWith('c1', 'admin1');
    });
  });

  describe('games', () => {
    it('lists with includeInactive=true for admins', () => {
      const q = { page: 1 } as any;
      expect(controller.listGames(q)).toBe('games');
      expect(games.findAll).toHaveBeenCalledWith(q, true);
    });
    it('creates', () => {
      const dto = { slug: 'g' } as any;
      expect(controller.createGame(dto, 'admin1')).toBe('g-created');
      expect(games.create).toHaveBeenCalledWith(dto, 'admin1');
    });
    it('updates', () => {
      const dto = { nameEn: 'G' } as any;
      expect(controller.updateGame('g1', dto, 'admin1')).toBe('g-updated');
      expect(games.update).toHaveBeenCalledWith('g1', dto, 'admin1');
    });
    it('removes', () => {
      expect(controller.removeGame('g1', 'admin1')).toBe('g-removed');
      expect(games.remove).toHaveBeenCalledWith('g1', 'admin1');
    });
  });

  describe('products', () => {
    it('lists via the admin (cost-aware) path', () => {
      const q = { page: 1 } as any;
      expect(controller.listProducts(q)).toBe('prods');
      expect(products.findAllAdmin).toHaveBeenCalledWith(q);
    });
    it('creates', () => {
      const dto = { sku: 'P' } as any;
      expect(controller.createProduct(dto, 'admin1')).toBe('p-created');
      expect(products.create).toHaveBeenCalledWith(dto, 'admin1');
    });
    it('updates', () => {
      const dto = { nameEn: 'P' } as any;
      expect(controller.updateProduct('p1', dto, 'admin1')).toBe('p-updated');
      expect(products.update).toHaveBeenCalledWith('p1', dto, 'admin1');
    });
    it('removes', () => {
      expect(controller.removeProduct('p1', 'admin1')).toBe('p-removed');
      expect(products.remove).toHaveBeenCalledWith('p1', 'admin1');
    });
  });
});
