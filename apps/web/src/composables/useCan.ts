import { useAuthStore } from '@/stores/auth'

/** 统一权限判断：禁止任何硬编码角色判断。 */
export function useCan() {
  const auth = useAuthStore()
  const can = (perm: string): boolean => auth.can(perm)
  const canAny = (list: readonly string[]): boolean => auth.canAny(list)
  const isOwner = (): boolean => auth.isOwner
  return { can, canAny, isOwner }
}
