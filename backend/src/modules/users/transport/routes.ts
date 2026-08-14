import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { AuthContext, AuthMiddleware, PublicUser } from '../../auth'
import type { ChangeRoleResult, CreateUserInput } from '../application/users'

export interface UsersRoutesDeps {
  requireAuth: AuthMiddleware
  requireAdmin: AuthMiddleware
  getById(id: string): Promise<PublicUser | null>
  list(): Promise<PublicUser[]>
  create(input: CreateUserInput): Promise<PublicUser | null>
  changeRole(input: { targetId: string; role: PublicUser['role'] }): Promise<ChangeRoleResult>
}

const serialize = (user: PublicUser) => ({
  ...user,
  createdAt: user.createdAt.toISOString(),
})

export function createUsersRoutes(deps: UsersRoutesDeps): Hono<AuthContext> {
  const routes = new Hono<AuthContext>()

  routes.get('/me', deps.requireAuth, async (c) => {
    const principal = c.get('principal')
    const user = await deps.getById(principal.userId)
    if (!user) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
    }
    return c.json(contracts.auth.meResponseSchema.parse({ user: serialize(user) }))
  })

  routes.get('/', deps.requireAuth, deps.requireAdmin, async (c) => {
    const users = await deps.list()
    return c.json(
      contracts.users.userListResponseSchema.parse({ users: users.map(serialize) }),
    )
  })

  routes.post('/', deps.requireAuth, deps.requireAdmin, async (c) => {
    const parsed = contracts.users.createUserRequestSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid user payload' } },
        400,
      )
    }

    const user = await deps.create(parsed.data)
    if (!user) {
      return c.json({ error: { code: 'CONFLICT', message: 'Email is already taken' } }, 409)
    }
    return c.json(contracts.users.userSchema.parse(serialize(user)), 201)
  })

  routes.patch('/:id/role', deps.requireAuth, deps.requireAdmin, async (c) => {
    const id = c.req.param('id')
    const idParsed = contracts.common.idSchema.safeParse(id)
    if (!idParsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid user id' } }, 400)
    }

    const parsed = contracts.users.changeRoleRequestSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid role payload' } },
        400,
      )
    }

    const result = await deps.changeRole({ targetId: idParsed.data, role: parsed.data.role })
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
      }
      return c.json(
        {
          error: {
            code: 'LAST_ADMIN',
            message: 'The last administrator cannot be demoted',
          },
        },
        409,
      )
    }

    return c.json(contracts.users.userSchema.parse(serialize(result.user)))
  })

  return routes
}
