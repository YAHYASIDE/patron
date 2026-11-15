import { RolesController } from '../../src/modules/roles/roles.controller';

describe('RolesController', () => {
  let roles: any;
  let controller: RolesController;

  beforeEach(() => {
    roles = {
      findAll: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'r1' }),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
      remove: jest.fn().mockResolvedValue({ message: 'Role deleted' }),
    };
    controller = new RolesController(roles);
  });

  it('findAll() delegates to the service', async () => {
    await expect(controller.findAll()).resolves.toEqual([{ id: 'r1' }]);
    expect(roles.findAll).toHaveBeenCalledWith();
  });

  it('findOne() forwards the path id', async () => {
    await controller.findOne('r1');
    expect(roles.findOne).toHaveBeenCalledWith('r1');
  });

  it('create() passes the dto and actor id', async () => {
    const dto = { name: 'ops' } as any;
    await expect(controller.create(dto, 'actor')).resolves.toEqual({ id: 'new' });
    expect(roles.create).toHaveBeenCalledWith(dto, 'actor');
  });

  it('update() passes id, dto, and actor id', async () => {
    const dto = { description: 'x' } as any;
    await controller.update('r1', dto, 'actor');
    expect(roles.update).toHaveBeenCalledWith('r1', dto, 'actor');
  });

  it('remove() passes id and actor id', async () => {
    await expect(controller.remove('r1', 'actor')).resolves.toEqual({ message: 'Role deleted' });
    expect(roles.remove).toHaveBeenCalledWith('r1', 'actor');
  });
});
