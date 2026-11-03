import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PERMS, PERM_GROUPS } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import { createRole, deleteRole, duplicateRole, listRoles, updateRole } from '../services/roles.js'
import { actorOf } from './users.js'

const roleSchema = z.object({
  name: z.string().min(2).max(24),
  description: z.string().max(200).optional(),
  perms: z.array(z.string()),
})

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/roles', { preHandler: requirePerm(PERMS.ROLE_READ) }, async () => ({ items: listRoles(app.db) }))

  app.get('/perms', { preHandler: requirePerm(PERMS.ROLE_READ) }, async () => ({
    groups: PERM_GROUPS,
    total: PERM_GROUPS.reduce((sum, group) => sum + group.perms.length, 0),
  }))

  app.post('/roles', { preHandler: requirePerm(PERMS.ROLE_WRITE) }, async (request, reply) => {
    const body = roleSchema.parse(request.body)
    const role = createRole(
      app.db,
      actorOf(request),
      { name: body.name, description: body.description ?? '', perms: body.perms },
      request.ip,
    )
    reply.code(201)
    return role
  })

  app.post('/roles/:id/duplicate', { preHandler: requirePerm(PERMS.ROLE_WRITE) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({ name: z.string().min(2).max(24) }).parse(request.body)
    const role = duplicateRole(app.db, actorOf(request), params.id, body.name, request.ip)
    reply.code(201)
    return role
  })

  app.patch('/roles/:id', { preHandler: requirePerm(PERMS.ROLE_WRITE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = roleSchema.partial().parse(request.body)
    const role = updateRole(
      app.db,
      actorOf(request),
      params.id,
      { name: body.name, description: body.description, perms: body.perms },
      request.ip,
    )
    app.perms.invalidateRole(params.id)
    return role
  })

  app.delete('/roles/:id', { preHandler: requirePerm(PERMS.ROLE_WRITE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    deleteRole(app.db, actorOf(request), params.id, request.ip)
    app.perms.invalidateRole(params.id)
    return { ok: true }
  })
}
