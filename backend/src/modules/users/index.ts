/**
 * The users module: profiles, listing and administrative role changes. Everything here is
 * behind authentication — the public index exposes only the Hono routes; consumers wire
 * them with the auth middleware injected from the auth module's public surface.
 */

import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthContext, AuthMiddleware, AuthModule, PublicUser } from '../auth'
import { createPasswordService, toPublicUser } from '../auth'
import { changeUserRole, createUser } from './application/users'
import type { CreateUserInput } from './application/users'
import { createUsersRepo } from './infrastructure/users-repo'
import { createUsersRoutes } from './transport/routes'

export interface UsersModuleDeps {
  db: Db
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface UsersModule {
  routes: Hono<AuthContext>
}

export function createUsersModule(deps: UsersModuleDeps): UsersModule {
  const repo = createUsersRepo(deps.db)
  const passwords = createPasswordService()
  const requireAdmin: AuthMiddleware = deps.auth.requireRole('admin')

  const routes = createUsersRoutes({
    requireAuth: deps.auth.requireAuth,
    requireAdmin,
    getById: async (id) => {
      const user = await repo.findById(id)
      return user ? toPublicUser(user) : null
    },
    list: async () => {
      const users = await repo.list()
      return users.map(toPublicUser)
    },
    create: (input: CreateUserInput) => createUser({ users: repo, passwords }, input),
    changeRole: (input) => changeUserRole({ users: repo, passwords }, input),
  })

  return { routes }
}

export type { PublicUser }
