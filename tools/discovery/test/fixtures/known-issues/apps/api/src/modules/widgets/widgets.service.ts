// Fixture: a module no unit test imports.
export class WidgetsService {
  list() {
    return [];
  }

  // TODO: soft-delete instead
  remove(id: string) {
    return { ok: Boolean(id) };
  }

  /* FIXME: validate the payload */
  import(body: unknown) {
    return { ok: body !== undefined };
  }
}
