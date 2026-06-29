import { Router, Response, NextFunction } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

const NEIS_BASE = 'https://open.neis.go.kr/hub'

// GET /api/meal?date=20240101
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const API_KEY = process.env.NEIS_API_KEY
    const OFFICE_CODE = process.env.NEIS_OFFICE_CODE
    const SCHOOL_CODE = process.env.NEIS_SCHOOL_CODE

    if (!API_KEY || !OFFICE_CODE || !SCHOOL_CODE) {
      return res.status(500).json({ error: '급식 API 설정이 없습니다' })
    }

    const date = (req.query.date as string) || getTodayStr()
    const url = `${NEIS_BASE}/mealServiceDietInfo?KEY=${API_KEY}&Type=json&ATPT_OFCDC_SC_CODE=${OFFICE_CODE}&SD_SCHUL_CODE=${SCHOOL_CODE}&MLSV_YMD=${date}`

    const resp = await fetch(url)
    const data: any = await resp.json()

    // 에러 처리
    const result = data?.mealServiceDietInfo?.[0]?.head?.[1]?.RESULT
    if (result?.CODE !== 'INFO-000') {
      return res.json({ meals: [] })
    }

    const rows = data?.mealServiceDietInfo?.[1]?.row ?? []

    const meals = rows.map((row: any) => {
      const items = parseMenuItems(row.DDISH_NM || '')
      const nutrition = parseNutrition(row.NTR_INFO || '')
      const origins = parseOrigins(row.ORPLC_INFO || '')

      return {
        type: getMealType(row.MMEAL_SC_CODE),
        type_code: row.MMEAL_SC_CODE,
        kcal: parseFloat(row.CAL_INFO?.replace('Kcal', '').trim()) || 0,
        items,
        nutrition,
        origins,
        date: row.MLSV_YMD,
      }
    })

    return res.json({ meals, date })
  } catch (err) {
    next(err)
  }
})

// GET /api/meal/week?date=20240101 — 주간 급식 (해당 주 월~금)
router.get('/week', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const API_KEY = process.env.NEIS_API_KEY
    const OFFICE_CODE = process.env.NEIS_OFFICE_CODE
    const SCHOOL_CODE = process.env.NEIS_SCHOOL_CODE

    if (!API_KEY || !OFFICE_CODE || !SCHOOL_CODE) {
      return res.status(500).json({ error: '급식 API 설정이 없습니다' })
    }

    const date = (req.query.date as string) || getTodayStr()
    const { from, to } = getWeekRange(date)

    const url = `${NEIS_BASE}/mealServiceDietInfo?KEY=${API_KEY}&Type=json&ATPT_OFCDC_SC_CODE=${OFFICE_CODE}&SD_SCHUL_CODE=${SCHOOL_CODE}&MLSV_FROM_YMD=${from}&MLSV_TO_YMD=${to}`

    const resp = await fetch(url)
    const data: any = await resp.json()

    const result = data?.mealServiceDietInfo?.[0]?.head?.[1]?.RESULT
    if (result?.CODE !== 'INFO-000') {
      return res.json({ meals: [], from, to })
    }

    const rows = data?.mealServiceDietInfo?.[1]?.row ?? []
    const meals = rows.map((row: any) => ({
      type: getMealType(row.MMEAL_SC_CODE),
      type_code: row.MMEAL_SC_CODE,
      kcal: parseFloat(row.CAL_INFO?.replace('Kcal', '').trim()) || 0,
      items: parseMenuItems(row.DDISH_NM || ''),
      nutrition: parseNutrition(row.NTR_INFO || ''),
      origins: parseOrigins(row.ORPLC_INFO || ''),
      date: row.MLSV_YMD,
    }))

    return res.json({ meals, from, to })
  } catch (err) {
    next(err)
  }
})

// ── 헬퍼 함수들 ──────────────────────────────────────

function getTodayStr() {
  const d = new Date()
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function getWeekRange(dateStr: string) {
  const y = parseInt(dateStr.slice(0, 4))
  const m = parseInt(dateStr.slice(4, 6)) - 1
  const d = parseInt(dateStr.slice(6, 8))
  const date = new Date(y, m, d)
  const day = date.getDay()
  const diffMon = day === 0 ? -6 : 1 - day
  const mon = new Date(date)
  mon.setDate(date.getDate() + diffMon)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  return { from: fmt(mon), to: fmt(fri) }
}

function getMealType(code: string) {
  if (code === '1') return '조식'
  if (code === '2') return '중식'
  if (code === '3') return '석식'
  return '급식'
}

function parseMenuItems(raw: string) {
  return raw
    .split('<br/>')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // 알레르기 번호 제거 (예: 김치찌개(9.13.) → 김치찌개)
      const name = s.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
      // 알레르기 번호 추출
      const allergyMatch = s.match(/\(([^)]+)\)/)
      const allergy = allergyMatch ? allergyMatch[1] : null
      return { name, allergy }
    })
}

function parseNutrition(raw: string) {
  const result: Record<string, number> = {}
  raw.split('<br/>').forEach(line => {
    const [key, val] = line.split(':').map(s => s.trim())
    if (key && val) {
      const num = parseFloat(val.replace(/[^0-9.]/g, ''))
      if (!isNaN(num)) result[key] = num
    }
  })
  return result
}

function parseOrigins(raw: string) {
  return raw
    .split('<br/>')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const parts = s.split(':').map(p => p.trim())
      return { name: parts[0], origin: parts[1] || '' }
    })
}

export default router