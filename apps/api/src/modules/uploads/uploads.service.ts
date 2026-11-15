import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type UploadKind = 'payment_proof' | 'logo' | 'banner';

/** An uploaded file as multer hands it over (memory storage). */
export interface IncomingFile {
  buffer: Buffer;
  size: number;
}

/** The phone compresses receipts; this is the ceiling for a logo or a banner picture. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The type comes from the file's first bytes, never from its name or the
 * browser's claim, so a script renamed .jpg is refused.
 */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Images kept in the database: transfer receipts (private) and shop pictures (public). */
@Injectable()
export class UploadsService {
  constructor(private prisma: PrismaService) {}

  private check(file: IncomingFile | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach an image');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('The image is too large (4 MB at most)');
    const mime = sniffImage(file.buffer);
    if (!mime) throw new BadRequestException('Only JPEG, PNG or WebP images');
    return mime;
  }

  /** A logo or banner picture anyone may load. */
  async savePublic(kind: Exclude<UploadKind, 'payment_proof'>, file: IncomingFile | undefined, userId: string) {
    const mime = this.check(file);
    const row = await this.prisma.upload.create({
      data: { kind, mime, size: file!.size, data: new Uint8Array(file!.buffer), isPublic: true, userId },
      select: { id: true },
    });
    return { id: row.id, path: `/uploads/${row.id}` };
  }

  /** The customer's receipt for a transfer; a new one replaces the previous. */
  async saveProof(paymentId: string, file: IncomingFile | undefined, userId: string) {
    const mime = this.check(file);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.upload.deleteMany({ where: { paymentId, kind: 'payment_proof' } });
      return tx.upload.create({
        data: { kind: 'payment_proof', mime, size: file!.size, data: new Uint8Array(file!.buffer), isPublic: false, userId, paymentId },
        select: { id: true },
      });
    });
    return { proofId: row.id };
  }

  async hasProof(paymentId: string): Promise<boolean> {
    return (await this.prisma.upload.count({ where: { paymentId, kind: 'payment_proof' } })) > 0;
  }

  async getPublic(id: string) {
    const row = await this.prisma.upload.findFirst({ where: { id, isPublic: true }, select: { mime: true, data: true } });
    if (!row) throw new NotFoundException('Image not found');
    return row;
  }

  async getProof(paymentId: string) {
    const row = await this.prisma.upload.findFirst({
      where: { paymentId, kind: 'payment_proof' },
      orderBy: { createdAt: 'desc' },
      select: { mime: true, data: true },
    });
    if (!row) throw new NotFoundException('No receipt for this payment');
    return row;
  }
}
