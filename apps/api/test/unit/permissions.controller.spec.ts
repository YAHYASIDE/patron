import { PermissionsController } from '../../src/modules/permissions/permissions.controller';

describe('PermissionsController', () => {
  let permissions: any;
  let controller: PermissionsController;

  beforeEach(() => {
    permissions = { findAllGrouped: jest.fn().mockResolvedValue({ users: [] }) };
    controller = new PermissionsController(permissions);
  });

  it('findAll() delegates to findAllGrouped', async () => {
    await expect(controller.findAll()).resolves.toEqual({ users: [] });
    expect(permissions.findAllGrouped).toHaveBeenCalledWith();
  });
});
