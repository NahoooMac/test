import { and, desc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.ts';
import { adminAuditLog, users } from '../../db/schema.ts';

/** Records an admin action. Call inside the same transaction as the change where possible. */
export async function audit(
  db: Tx,
  actorId: string,
  action: string,
  target: { type: string; id: string },
  details?: Record<string, unknown>,
) {
  await db.insert(adminAuditLog).values({
    actorId,
    action,
    targetType: target.type,
    targetId: target.id,
    details: details ?? null,
  });
}

export async function auditFor(db: Db, targetType: string, targetId: string) {
  const rows = await db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      details: adminAuditLog.details,
      createdAt: adminAuditLog.createdAt,
      actorName: users.fullName,
      actorPhone: users.phoneE164,
    })
    .from(adminAuditLog)
    .innerJoin(users, eq(users.id, adminAuditLog.actorId))
    .where(and(eq(adminAuditLog.targetType, targetType), eq(adminAuditLog.targetId, targetId)))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
