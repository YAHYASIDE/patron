export class GadgetsService {
  archive(id: string) {
    return { id, archived: true };
  }
}
