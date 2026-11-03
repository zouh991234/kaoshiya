import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PERMS } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import type { AuthContext } from '../rbac/resolve.js'
import type { Actor } from '../services/roles.js'
import { createUser, deleteUser, getUser, listUsers, resetUserPassword, setUserRoles, updateUser } from '../services/users.js'

export function actorOf(request: { auth: AuthContext | null }): Actor {
  const auth = request.auth
  if (!auth) throw new Error('authenticate 必须在此前执行')
  return { userId: auth.userId, isOwner: auth.isOwner, perms: auth.perms }
}

const createSchema = z.object({
  username: z.string().min(3).max(32),
  displayName: z.string().max(40).optional(),
  roleIds: z.array(z.string()).min(1),
})

const updateSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  username: z.string().min(3).max(32).optional(),
})

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', { preHandler: requirePerm(PERMS.USER_READ) }, async (request) => {
    const query = z
      .object({
        keyword: z.string().max(64).optional(),
        roleId: z.string().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query)
    return listUsers(app.db, query)
  })

  app.get('/users/:id', { preHandler: requirePerm(PERMS.USER_READ) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    return getUser(app.db, params.id)
  })

  app.post('/users', { preHandler: requirePerm(PERMS.USER_CREATE) }, async (request, reply) => {
    const body = createSchema.parse(request.body)
    const result = await createUser(app.db, actorOf(request), body, request.ip)
    for (const role of result.user.roles) app.perms.invalidateRole(role.id)
    reply.code(201)
    return result
  })

  app.patch('/users/:id', { preHandler: requirePerm(PERMS.USER_UPDATE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = updateSchema.parse(request.body)
    const updated = updateUser(app.db, actorOf(request), params.id, body, request.ip)
    app.perms.invalidate(params.id)
    return updated
  })

  app.put('/users/:id/roles', { preHandler: requirePerm(PERMS.USER_UPDATE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({ roleIds: z.array(z.string()) }).parse(request.body)
    const updated = setUserRoles(app.db, actorOf(request), params.id, body.roleIds, request.ip)
    app.perms.invalidate(params.id)
    return updated
  })

  app.post('/users/:id/reset-password', { preHandler: requirePerm(PERMS.USER_RESETPWD) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    return resetUserPassword(app.db, actorOf(request), params.id, request.ip)
  })

  app.delete('/users/:id', { preHandler: requirePerm(PERMS.USER_DELETE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    deleteUser(app.db, actorOf(request), params.id, request.ip)
    app.perms.invalidate(params.id)
    return { ok: true }
  })
}
