import { Server as HTTPServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { verifyToken } from './lib/jwt'
import prisma from './lib/prisma'

export function initSocket(httpServer: HTTPServer) {
  // CLIENT_URL 환경변수를 사용 (하드코딩된 localhost 제거)
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

    // 채팅방 입장
    socket.on('room:join', (roomId: number) => {
      socket.join(`room:${roomId}`)
    })

    // 채팅방 퇴장
    socket.on('room:leave', (roomId: number) => {
      socket.leave(`room:${roomId}`)
    })

    // 메시지 전송
    socket.on('message:send', async (data: { roomId: number; content: string }) => {
      try {
        const msg = await prisma.message.create({
          data: {
            roomId: data.roomId,
            userId: socket.data.userId,
            content: data.content,
          },
          include: { author: true, reactions: true },
        })

        const formatted = {
          id: msg.id,
          room_id: msg.roomId,
          user_id: msg.userId,
          user_name: msg.author.name,
          avatar_text: msg.author.avatarText,
          avatar_color: msg.author.avatarColor,
          is_teacher: msg.author.role === 'teacher',
          content: msg.content,
          created_at: msg.createdAt,
          reactions: [],
        }
        io.to(`room:${data.roomId}`).emit('message:receive', formatted)
      } catch (err) {
        console.error('[Socket] message:send error:', err)
        socket.emit('error', { message: '메시지 전송 실패' })
      }
    })

    // 타이핑 중 표시 — roomId를 함께 전달해야 프론트에서 어느 방인지 알 수 있음
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
