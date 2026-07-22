import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { RequestContextStore } from '../../src/common/context/request-context';

const makeHost = (url = '/orders/1', method = 'POST') => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const req = { url, method };
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => req,
      }),
    } as any,
    res,
    req,
  };
};

const knownRequestError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: '5.0.0',
    meta,
  } as any);

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // Silence and observe the filter's private logger.
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((filter as any).logger, 'warn').mockImplementation(() => undefined);
  });

  const bodyOf = (res: any) => res.json.mock.calls[0][0];

  it('maps an HttpException with a string payload, deriving the error from its name', () => {
    const { host, res } = makeHost();
    // A raw string response takes the string branch (name stripped of "Exception").
    filter.catch(new HttpException('missing thing', HttpStatus.NOT_FOUND), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = bodyOf(res);
    expect(body).toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Http',
      message: 'missing thing',
      path: '/orders/1',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('reads the structured payload NestjS built-ins produce', () => {
    const { host, res } = makeHost();
    filter.catch(new NotFoundException('missing thing'), host);
    // NestJS wraps the string into { statusCode, message, error } so the object branch runs.
    expect(bodyOf(res)).toMatchObject({ error: 'Not Found', message: 'missing thing' });
  });

  it('honours the error and message fields of an object payload', () => {
    const { host, res } = makeHost();
    const exception = new BadRequestException({ message: ['a', 'b'], error: 'Validation' });
    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(bodyOf(res)).toMatchObject({ error: 'Validation', message: ['a', 'b'] });
  });

  it('falls back to the exception message/name when the object payload omits them', () => {
    const { host, res } = makeHost();
    // An object response with neither message nor error.
    const exception = new BadRequestException({ foo: 'bar' } as any);
    filter.catch(exception, host);

    const body = bodyOf(res);
    expect(body.error).toBe('BadRequest');
    expect(body.message).toBe(exception.message);
  });

  it('returns a generic 500 and logs the stack for an unhandled Error', () => {
    const { host, res } = makeHost('/x', 'GET');
    const err = new Error('kaboom');
    filter.catch(err, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(bodyOf(res)).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
    expect((filter as any).logger.error).toHaveBeenCalledWith(
      'GET /x → 500',
      err.stack,
    );
  });

  it('stringifies a non-Error thrown value in the 500 log', () => {
    const { host } = makeHost();
    filter.catch('a plain string', host);
    expect((filter as any).logger.error).toHaveBeenCalledWith(
      expect.stringContaining('→ 500'),
      'a plain string',
    );
  });

  it('maps a Prisma P2002 with a known target to a friendly 409', () => {
    const { host, res } = makeHost();
    filter.catch(knownRequestError('P2002', { target: ['email'] }), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(bodyOf(res)).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'That email address is already in use',
    });
    expect((filter as any).logger.warn).toHaveBeenCalled();
  });

  it('does not echo an unknown constraint target back to the client', () => {
    const { host, res } = makeHost();
    filter.catch(knownRequestError('P2002', { target: ['users_secret_idx'] }), host);
    expect(bodyOf(res).message).toBe('This record already exists');
  });

  it('handles a P2002 with a non-array target', () => {
    const { host, res } = makeHost();
    filter.catch(knownRequestError('P2002', { target: 'email' }), host);
    expect(bodyOf(res).message).toBe('This record already exists');
  });

  it('maps a Prisma P2003 foreign-key failure to 400', () => {
    const { host, res } = makeHost();
    filter.catch(knownRequestError('P2003'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(bodyOf(res).message).toBe('Referenced record does not exist');
  });

  it('maps a Prisma P2025 missing-record to 404', () => {
    const { host, res } = makeHost();
    filter.catch(knownRequestError('P2025'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(bodyOf(res).message).toBe('Record not found');
  });

  it('falls through to a generic 500 for an unmapped Prisma code', () => {
    const { host, res } = makeHost();
    filter.catch(knownRequestError('P2000'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(bodyOf(res).message).toBe('Internal server error');
  });

  it('carries the active correlation id into the response envelope', () => {
    const { host, res } = makeHost();
    RequestContextStore.run(
      { correlationId: 'corr-123' },
      () => filter.catch(new NotFoundException('x'), host),
    );
    expect(bodyOf(res).correlationId).toBe('corr-123');
  });

  it('uses the sentinel correlation id when there is no request context', () => {
    const { host, res } = makeHost();
    filter.catch(new NotFoundException('x'), host);
    expect(bodyOf(res).correlationId).toBe('no-correlation-id');
  });
});
