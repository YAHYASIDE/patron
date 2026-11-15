import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MAX_UPLOAD_BYTES, UploadsService, sniffImage } from '../../src/modules/uploads/uploads.service';
import { UploadsAdminController, UploadsController, sendImage } from '../../src/modules/uploads/uploads.controller';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('sniffImage', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(WEBP)).toBe('image/webp');
  });

  it('refuses anything else, whatever it is called', () => {
    expect(sniffImage(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('UploadsService', () => {
  let prisma: any;
  let service: UploadsService;

  beforeEach(() => {
    const tx = {
      upload: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({ id: 'proof-2' }) },
    };
    prisma = {
      upload: {
        create: jest.fn().mockResolvedValue({ id: 'logo-1' }),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({ mime: 'image/png', data: PNG }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      tx,
    };
    service = new UploadsService(prisma);
  });

  it('stores a public logo with the sniffed type and returns its path', async () => {
    await expect(service.savePublic('logo', { buffer: PNG, size: PNG.length }, 'admin-1')).resolves.toEqual({
      id: 'logo-1',
      path: '/uploads/logo-1',
    });
    const data = prisma.upload.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'logo', mime: 'image/png', isPublic: true, userId: 'admin-1', size: PNG.length });
  });

  it('refuses a missing, oversized or non-image file', async () => {
    await expect(service.savePublic('logo', undefined, 'a')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.savePublic('logo', { buffer: JPEG, size: MAX_UPLOAD_BYTES + 1 }, 'a')).rejects.toThrow('too large');
    await expect(service.savePublic('banner', { buffer: Buffer.from('hello'), size: 5 }, 'a')).rejects.toThrow('JPEG, PNG or WebP');
    expect(prisma.upload.create).not.toHaveBeenCalled();
  });

  it('keeps one private receipt per payment, replacing the previous one', async () => {
    await expect(service.saveProof('pay1', { buffer: JPEG, size: JPEG.length }, 'u1')).resolves.toEqual({ proofId: 'proof-2' });
    expect(prisma.tx.upload.deleteMany).toHaveBeenCalledWith({ where: { paymentId: 'pay1', kind: 'payment_proof' } });
    expect(prisma.tx.upload.create.mock.calls[0][0].data).toMatchObject({ kind: 'payment_proof', isPublic: false, paymentId: 'pay1', mime: 'image/jpeg' });
  });

  it('tells whether a payment has a receipt', async () => {
    await expect(service.hasProof('pay1')).resolves.toBe(true);
    prisma.upload.count.mockResolvedValueOnce(0);
    await expect(service.hasProof('pay1')).resolves.toBe(false);
  });

  it('serves only public images publicly, and a receipt only by payment', async () => {
    await expect(service.getPublic('logo-1')).resolves.toEqual(expect.objectContaining({ mime: 'image/png' }));
    expect(prisma.upload.findFirst.mock.calls[0][0].where).toEqual({ id: 'logo-1', isPublic: true });
    prisma.upload.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPublic('secret')).rejects.toBeInstanceOf(NotFoundException);

    await service.getProof('pay1');
    expect(prisma.upload.findFirst.mock.calls[2][0].where).toEqual({ paymentId: 'pay1', kind: 'payment_proof' });
    prisma.upload.findFirst.mockResolvedValueOnce(null);
    await expect(service.getProof('pay2')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Uploads controllers', () => {
  const res = () => ({ setHeader: jest.fn(), end: jest.fn() }) as any;

  it('sends image bytes that another origin may load', () => {
    const r = res();
    sendImage(r, { mime: 'image/png', data: PNG }, 'public, max-age=1');
    expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(r.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(r.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(r.end).toHaveBeenCalledWith(PNG);
  });

  it('serves a public image with a long cache', async () => {
    const uploads = { getPublic: jest.fn().mockResolvedValue({ mime: 'image/jpeg', data: JPEG }) } as any;
    const r = res();
    await new UploadsController(uploads).get('id-1', r);
    expect(r.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
  });

  it('stores logos and banner pictures for the acting admin', () => {
    const uploads = { savePublic: jest.fn().mockReturnValue('saved') } as any;
    const c = new UploadsAdminController(uploads);
    const file = { buffer: PNG, size: PNG.length };
    expect(c.logo(file, 'a1')).toBe('saved');
    expect(uploads.savePublic).toHaveBeenCalledWith('logo', file, 'a1');
    expect(c.banner(file, 'a1')).toBe('saved');
    expect(uploads.savePublic).toHaveBeenCalledWith('banner', file, 'a1');
  });
});
