import { UsersController } from '../../src/modules/users/users.controller';

describe('UsersController', () => {
  let users: any;
  let controller: UsersController;

  beforeEach(() => {
    users = {
      findOne: jest.fn().mockResolvedValue({ id: 'u1' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      adminUpdate: jest.fn().mockResolvedValue({ id: 'u1' }),
      setBlocked: jest.fn().mockResolvedValue({ id: 'u1' }),
      remove: jest.fn().mockResolvedValue({ message: 'User deleted' }),
    };
    controller = new UsersController(users);
  });

  it('me() looks up the current user by id', async () => {
    await expect(controller.me('u1')).resolves.toEqual({ id: 'u1' });
    expect(users.findOne).toHaveBeenCalledWith('u1');
  });

  it('updateMe() delegates to updateProfile with the caller id and dto', async () => {
    const dto = { fullName: 'Jane' } as any;
    await controller.updateMe('u1', dto);
    expect(users.updateProfile).toHaveBeenCalledWith('u1', dto);
  });

  it('findAll() forwards the query', async () => {
    const query = { page: 2 } as any;
    await controller.findAll(query);
    expect(users.findAll).toHaveBeenCalledWith(query);
  });

  it('findOne() forwards the path id', async () => {
    await controller.findOne('u9');
    expect(users.findOne).toHaveBeenCalledWith('u9');
  });

  it('create() passes the dto and actor id', async () => {
    const dto = { email: 'a@b.c' } as any;
    await expect(controller.create(dto, 'actor')).resolves.toEqual({ id: 'new' });
    expect(users.create).toHaveBeenCalledWith(dto, 'actor');
  });

  it('update() passes id, dto, and actor id', async () => {
    const dto = { isActive: false } as any;
    await controller.update('u1', dto, 'actor');
    expect(users.adminUpdate).toHaveBeenCalledWith('u1', dto, 'actor');
  });

  it('setBlocked() passes id, dto, and actor id', async () => {
    const dto = { blocked: true } as any;
    await controller.setBlocked('u1', dto, 'actor');
    expect(users.setBlocked).toHaveBeenCalledWith('u1', dto, 'actor');
  });

  it('remove() passes id and actor id', async () => {
    await expect(controller.remove('u1', 'actor')).resolves.toEqual({ message: 'User deleted' });
    expect(users.remove).toHaveBeenCalledWith('u1', 'actor');
  });
});
