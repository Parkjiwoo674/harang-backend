import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { formatUser } from './auth'

const router = Router()

// Cloudinary 설정
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// multer-storage-cloudinary 설정
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'harang/profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 400, height: 400, crop: 'fill' }],
  } as any,
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('이미지 파일만 업로드 가능합니다'))
  },
})

// GET /api/users
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({ where: { isActive: true } })
    return res.json(users.map(formatUser))
  } catch (err) {
    next(err)
  }
})

// GET /api/users/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } })
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' })
    return res.json(formatUser(user))
  } catch (err) {
    next(err)
  }
})

// PATCH /api/users/me — 프로필 정보 수정
router.patch('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      bio: z.string().optional(),
      avatar_text: z.string().max(2).optional(),
      avatar_color: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const { name, phone, email, bio, avatar_text, avatar_color } = parsed.data

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(name && { name }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(bio !== undefined && { bio }),
        ...(avatar_text && { avatarText: avatar_text }),
        ...(avatar_color && { avatarColor: avatar_color }),
      },
    })
    return res.json(formatUser(user))
  } catch (err) {
    next(err)
  }
})

// PATCH /api/users/me/password — 비밀번호 변경
router.patch('/me/password', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(4),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const { current_password, new_password } = parsed.data

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' })

    const ok = await bcrypt.compare(current_password, user.hashedPassword)
    if (!ok) return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다' })

    const hashed = await bcrypt.hash(new_password, 10)
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { hashedPassword: hashed },
    })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/users/me/avatar — 프로필 사진 업로드
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다' })

    // 기존 Cloudinary 이미지 삭제
    const existing = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (existing?.profileImage) {
      const urlParts = existing.profileImage.split('/')
      const publicIdWithExt = urlParts.slice(-2).join('/')
      const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '')
      await cloudinary.uploader.destroy(publicId).catch(() => {})
    }

    const profileImage = (req.file as any).path
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { profileImage },
    })
    return res.json({ profile_image: profileImage, user: formatUser(user) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/users/me/avatar — 프로필 사진 삭제
router.delete('/me/avatar', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (existing?.profileImage) {
      const urlParts = existing.profileImage.split('/')
      const publicIdWithExt = urlParts.slice(-2).join('/')
      const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '')
      await cloudinary.uploader.destroy(publicId).catch(() => {})
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { profileImage: null },
    })
    return res.json(formatUser(user))
  } catch (err) {
    next(err)
  }
})

export default router