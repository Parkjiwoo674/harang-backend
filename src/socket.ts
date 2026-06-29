import { Server as HTTPServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { verifyToken } from './lib/jwt'
import prisma from './lib/prisma'

export function initSocket(httpServer: HTTPServer) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000'

  const io = new SocketIOServer(httpServer, {
    cors: { origin: clientUrl, credentials: true },
  })

  // 인증 미들웨어
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token
    if (!token) return next(new Error('인증 필요'))
    try {
      const { userId } = verifyToken(token)
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user || !user.isActive) return next(new Error('유효하지 않은 토큰'))
      socket.data.userId = user.id
      socket.data.userName = user.name
      socket.data.avatarText = user.avatarText
      socket.data.avatarColor = user.avatarColor
      socket.data.isTeacher = user.role === 'teacher'
      next()
    } catch {
      next(new Error('유효하지 않은 토큰'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`✅ User ${socket.data.userName} connected`)

    // 방 입장 시 읽음 처리
    socket.on('room:join', async (roomId: number) => {
      socket.join(`room:${roomId}`)
      try {
        const myId = socket.data.userId
        const messages = await prisma.message.findMany({
          where: { roomId, userId: { not: myId } },
          select: { id: true },
        })
        if (messages.length > 0) {
          await prisma.messageRead.createMany({
            data: messages.map(m => ({ messageId: m.id, userId: myId })),
            skipDuplicates: true,
          })
          // 읽은 메시지 ID 목록도 같이 브로드캐스트
          socket.to(`room:${roomId}`).emit('message:read', {
            room_id: roomId,
            user_id: myId,
            user_name: socket.data.userName,
            message_ids: messages.map(m => m.id),
          })
        }
      } catch (err) {
        console.error('[Socket] room:join read error:', err)
      }
    })

    socket.on('room:leave', (roomId: number) => {
      socket.leave(`room:${roomId}`)
    })

    // 메시지 전송
    socket.on('message:send', async (data: { roomId: number; content: string }) => {
      try {
        const room = await prisma.room.findUnique({ where: { id: data.roomId } })
        if (!room) { socket.emit('error', { message: '채팅방을 찾을 수 없습니다' }); return }
        if (room.isTeacherOnly && !socket.data.isTeacher) {
          socket.emit('error', { message: '선생님만 메시지를 보낼 수 있습니다' }); return
        }
        const member = await prisma.roomMember.findUnique({
          where: { roomId_userId: { roomId: data.roomId, userId: socket.data.userId } },
        })
        if (!member) { socket.emit('error', { message: '채팅방 멤버가 아닙니다' }); return }

        const msg = await prisma.message.create({
          data: { roomId: data.roomId, userId: socket.data.userId, content: data.content },
          include: { author: true, reactions: true, reads: { include: { user: true } } },
        })

        // 현재 방에 접속 중인 멤버 자동 읽음 처리
        const roomSockets = await io.in(`room:${data.roomId}`).fetchSockets()
        const onlineUserIds = roomSockets
          .map(s => s.data.userId)
          .filter((id: number) => id !== socket.data.userId)

        if (onlineUserIds.length > 0) {
          await prisma.messageRead.createMany({
            data: onlineUserIds.map((userId: number) => ({ messageId: msg.id, userId })),
            skipDuplicates: true,
          })
        }

        // 최신 reads 포함해서 다시 조회
        const updatedMsg = await prisma.message.findUnique({
          where: { id: msg.id },
          include: { author: true, reactions: true, reads: { include: { user: true } } },
        })

        const formatted = {
          id: updatedMsg!.id,
          room_id: updatedMsg!.roomId,
          user_id: updatedMsg!.userId,
          user_name: updatedMsg!.author.name,
          avatar_text: updatedMsg!.author.avatarText,
          avatar_color: updatedMsg!.author.avatarColor,
          profile_image: (updatedMsg!.author as any).profileImage ?? null,
          is_teacher: updatedMsg!.author.role === 'teacher',
          content: updatedMsg!.content,
          created_at: updatedMsg!.createdAt,
          reactions: [],
          read_by: updatedMsg!.reads.map((r: any) => ({
            user_id: r.userId,
            user_name: r.user?.name ?? '',
            read_at: r.readAt,
          })),
          read_count: updatedMsg!.reads.length,
        }

        io.to(`room:${data.roomId}`).emit('message:receive', formatted)
      } catch (err) {
        console.error('[Socket] message:send error:', err)
        socket.emit('error', { message: '메시지 전송 실패' })
      }
    })

    // 클라이언트가 명시적으로 읽음 처리 요청
    socket.on('message:read', async (data: { roomId: number }) => {
      try {
        const myId = socket.data.userId
        const messages = await prisma.message.findMany({
          where: { roomId: data.roomId, userId: { not: myId } },
          select: { id: true },
        })
        if (messages.length > 0) {
          await prisma.messageRead.createMany({
            data: messages.map(m => ({ messageId: m.id, userId: myId })),
            skipDuplicates: true,
          })
          socket.to(`room:${data.roomId}`).emit('message:read', {
            room_id: data.roomId,
            user_id: myId,
            user_name: socket.data.userName,
            message_ids: messages.map(m => m.id),
          })
        }
      } catch (err) {
        console.error('[Socket] message:read error:', err)
      }
    })

    socket.on('typing:start', (roomId: number) => {
      socket.to(`room:${roomId}`).emit('typing:user', {
        userId: socket.data.userId,
        userName: socket.data.userName,
        roomId,
      })
    })

    socket.on('typing:stop', (roomId: number) => {
      socket.to(`room:${roomId}`).emit('typing:stop', {
        userId: socket.data.userId,
        roomId,
      })
    })

    socket.on('disconnect', () => {
      console.log(`❌ User ${socket.data.userName} disconnected`)
    })
  })

  return io
}