import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Destination } from './codes.service';
import { isEmail } from '../../common/validation/email';

export const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * What a customer typed to name their account: an email or an E.164 number.
 * Spaces, dashes and brackets in a number are dropped; "00" becomes "+".
 */
export function parseIdentifier(raw: string | undefined | null): Destination {
  const value = (raw ?? '').trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (isEmail(email)) return { kind: 'email', to: email };
  } else {
    const phone = value.replace(/[\s\-().]/g, '').replace(/^00/, '+');
    if (E164.test(phone)) return { kind: 'phone', to: phone };
  }
  throw new BadRequestException({
    error: 'INVALID_IDENTIFIER',
    message: 'Enter an email or a phone number in international format, e.g. +22212345678',
  });
}

/** The where-clause that finds the live account an identifier names. */
export function accountWhere(id: Destination): Prisma.UserWhereInput {
  return id.kind === 'email' ? { email: id.to, deletedAt: null } : { phone: id.to, deletedAt: null };
}

/** "+222****3456", "a***@example.com": enough for staff and customers to recognise, not to harvest. */
export function maskContact(dest: Destination): string {
  if (dest.kind === 'phone') return dest.to.length > 8 ? `${dest.to.slice(0, 4)}****${dest.to.slice(-4)}` : '****';
  const [name, domain] = dest.to.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}
