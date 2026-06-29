import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

function formatRoom(room: any, myId: number, unreadCount = 0) {
  const memberIds = room.members?.map((m: any) => m.userId) ?? []
  const msgs: any[] = room.messages ?? []
  const last = msgs[msgs.length - 1]
  return {
    id: room.id,
    kind: room.kind,
    name: room.name,
    emoji: room.emoji,
    description: room.description,
    is_teacher_only: room.isTeacherOnly,
    created_by: room.createdById,
    member_ids: memberIds,
    last_message: last?.content?.slice(0, 40) ?? null,
    last_time: last
      ? new Date(last.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
      : null,
    unread: unreadCount,
  }
}

function formatMessage(msg: any, myId?: number) {
  const reactionMap: Record<string, number> = {}
  for (const r of msg.reactions ?? []) {
    reactionMap[r.emoji] = (reactionMap[r.emoji] ?? 0) + 1
  }
  // 읽은 사람 목록
  const readBy = (msg.reads ?? []).map((r: any) => ({
    user_id: r.userId,
    user_name: r.user?.name ?? '',
    read_at: r.readAt,
  }))
  return {
    id: msg.id,
    room_id: msg.roomId,
    user_id: msg.userId,
    user_name: msg.author?.name ?? '',
    avatar_text: msg.author?.avatarText ?? '?',
    avatar_color: msg.author?.avatarColor ?? '#22c55e',
    profile_image: msg.author?.profileImage ?? null,
    is_teacher: msg.author?.role === 'teacher',
    content: msg.content,
    created_at: msg.createdAt,
    reactions: Object.entries(reactionMap).map(([emoji, count]) => ({ emoji, count })),
    read_by: readBy,
    read_count: readBy.length,
  }
}

const roomInclude = {
  members: true,
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: true, reactions: true, reads: { include: { user: true } } },
  },
}

// GET /api/chat/rooms
router.get('/rooms', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const myId = req.user!.id
    const rooms = await prisma.room.findMany({
      where: { members: { some: { userId: myId } } },
      include: roomInclude,
      orderBy: { id: 'asc' },
    })

    // 각 방의 unread 카운트 계산
    const result = await Promise.all(rooms.map(async (r: any) => {
      const unread = await prisma.message.count({
        where: {
          roomId: r.id,
          userId: { not: myId }, // 내가 보낸 메시지 제외
          reads: { none: { userId: myId } }, // 내가 읽지 않은 것
        },
      })
      return formatRoom(r, myId, unread)
    }))

    return res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/chat/rooms
router.post('/rooms', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      kind: z.enum(['class_notice', 'class_free', 'class_question', 'group', 'dm']),
      name: z.string().min(1),
      emoji: z.string().default('💬'),
      description: z.string().optional(),
      is_teacher_only: z.boolean().default(false),
      member_ids: z.array(z.number()).default([]),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data

    // DM 중복 체크
    if (data.kind === 'dm' && data.member_ids.length === 2) {
      const [idA, idB] = [...data.member_ids].sort((a, b) => a - b)
      const candidates = await prisma.room.findMany({
        where: {
          kind: 'dm',
          AND: [
            { members: { some: { userId: idA } } },
            { members: { some: { userId: idB } } },
          ],
        },
        include: roomInclude,
      })
      const existing = candidates.find((r: any) => {
        const ids = r.members.map((m: any) => m.userId).sort((a: number, b: number) => a - b)
        return ids.length === 2 && ids[0] === idA && ids[1] === idB
      })
      if (existing) return res.json(formatRoom(existing, req.user!.id))
    }

    const memberIds = [...new Set([...data.member_ids, req.user!.id])]
    const room = await prisma.room.create({
      data: {
        kind: data.kind,
        name: data.name,
        emoji: data.emoji,
        description: data.description,
        isTeacherOnly: data.is_teacher_only,
        createdById: req.user!.id,
        members: { create: memberIds.map((uid) => ({ userId: uid })) },
      },
      include: roomInclude,
    })
    return res.status(201).json(formatRoom(room, req.user!.id))
  } catch (err) {
    next(err)
  }
})

// DELETE /api/chat/rooms/:id
router.delete('/rooms/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: Number(req.params.id) } })
    if (!room) return res.status(404).json({ error: '채팅방을 찾을 수 없습니다' })
    if (room.createdById !== req.user!.id && req.user!.role !== 'teacher') {
      return res.status(403).json({ error: '삭제 권한이 없습니다' })
    }
    await prisma.room.delete({ where: { id: room.id } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/chat/rooms/:id/messages
router.get('/rooms/:id/messages', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roomId = Number(req.params.id)
    const myId = req.user!.id

    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: myId } },
    })
    if (!member) return res.status(403).json({ error: '채팅방 멤버가 아닙니다' })

    const messages = await prisma.message.findMany({
      where: { roomId },
      include: { author: true, reactions: true, reads: { include: { user: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // 방 입장 시 모든 메시지 읽음 처리
    const unreadIds = messages
      .filter(m => m.userId !== myId && !m.reads.some((r: any) => r.userId === myId))
      .map(m => m.id)

    if (unreadIds.length > 0) {
      await prisma.messageRead.createMany({
        data: unreadIds.map(messageId => ({ messageId, userId: myId })),
        skipDuplicates: true,
      })
    }

    return res.json(messages.map(m => formatMessage(m, myId)))
  } catch (err) {
    next(err)
  }
})

// POST /api/chat/rooms/:id/read — 특정 방 전체 읽음 처리
router.post('/rooms/:id/read', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roomId = Number(req.params.id)
    const myId = req.user!.id

    const messages = await prisma.message.findMany({
      where: { roomId, userId: { not: myId } },
      select: { id: true },
    })

    await prisma.messageRead.createMany({
      data: messages.map(m => ({ messageId: m.id, userId: myId })),
      skipDuplicates: true,
    })

    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/chat/rooms/:id/messages
router.post('/rooms/:id/messages', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roomId = Number(req.params.id)
    const schema = z.object({ content: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '내용을 입력해주세요' })

    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: req.user!.id } },
    })
    if (!member) return res.status(403).json({ error: '채팅방 멤버가 아닙니다' })

    const room = await prisma.room.findUnique({ where: { id: roomId } })
    if (!room) return res.status(404).json({ error: '채팅방을 찾을 수 없습니다' })
    if (room.isTeacherOnly && req.user!.role !== 'teacher') {
      return res.status(403).json({ error: '선생님만 메시지를 보낼 수 있습니다' })
    }

    const msg = await prisma.message.create({
      data: { roomId, userId: req.user!.id, content: parsed.data.content },
      include: { author: true, reactions: true, reads: { include: { user: true } } },
    })
    return res.status(201).json(formatMessage(msg, req.user!.id))
  } catch (err) {
    next(err)
  }
})

// POST /api/chat/messages/:id/react
router.post('/messages/:id/react', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const messageId = Number(req.params.id)
    const schema = z.object({ emoji: z.string() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '이모지를 입력해주세요' })

    const existing = await prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId: req.user!.id, emoji: parsed.data.emoji } },
    })
    if (existing) {
      await prisma.reaction.delete({ where: { id: existing.id } })
    } else {
      await prisma.reaction.create({
        data: { messageId, userId: req.user!.id, emoji: parsed.data.emoji },
      })
    }
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router