import prisma from './lib/prisma'

/**
 * 교사 인증 코드 생성 스크립트
 * 사용법:
 *   npm run generate-code           # 1개 생성
 *   npm run generate-code 5         # 5개 생성
 *   npm run list-codes              # 전체 코드 조회
 *   npm run list-codes unused       # 미사용 코드만 조회
 */

function generateCode(): string {
  // 8자리 랜덤 코드 (대문자 + 숫자)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 혼동되는 문자 제외 (I, O, 0, 1)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

async function createCodes(count: number) {
  console.log(`\n🔑 교사 인증 코드 ${count}개 생성 중...\n`)
  
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    let code = generateCode()
    // 중복 체크
    while (await prisma.teachercode.findUnique({ where: { code } })) {
      code = generateCode()
    }
    
    await prisma.teachercode.create({ data: { code } })
    codes.push(code)
  }
  
  console.log('✅ 생성 완료!\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  codes.forEach((code, i) => {
    console.log(`${i + 1}. ${code}`)
  })
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('💡 이 코드를 교사에게 전달하세요.')
  console.log('   회원가입 시 "교사 인증 코드" 입력란에 사용합니다.\n')
}

async function listCodes(filter?: string) {
  const where = filter === 'unused' ? { isUsed: false } : {}
  const codes = await prisma.teachercode.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, name: true, username: true }
      }
    }
  })
  
  if (codes.length === 0) {
    console.log('\n⚠️  등록된 코드가 없습니다.')
    console.log('   npm run generate-code 명령으로 코드를 생성하세요.\n')
    return
  }
  
  console.log(`\n📋 교사 인증 코드 목록 (총 ${codes.length}개)\n`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('코드\t\t상태\t\t사용자\t\t\t생성일')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  codes.forEach(c => {
    const status = c.isUsed ? '✓ 사용됨' : '○ 미사용'
    const user = c.isUsed && c.user 
      ? `${c.user.name} (${c.user.username})`
      : '-'
    const date = c.createdAt.toISOString().split('T')[0]
    console.log(`${c.code}\t${status}\t\t${user}\t${date}`)
  })
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  const unused = codes.filter(c => !c.isUsed).length
  const used = codes.filter(c => c.isUsed).length
  console.log(`📊 통계: 미사용 ${unused}개 / 사용됨 ${used}개\n`)
}

async function deleteCode(code: string) {
  const existing = await prisma.teachercode.findUnique({ where: { code } })
  
  if (!existing) {
    console.log(`\n❌ 코드 "${code}"를 찾을 수 없습니다.\n`)
    return
  }
  
  if (existing.isUsed) {
    console.log(`\n⚠️  코드 "${code}"는 이미 사용된 코드입니다.`)
    console.log('   사용된 코드는 삭제할 수 없습니다.\n')
    return
  }
  
  await prisma.teachercode.delete({ where: { code } })
  console.log(`\n✅ 코드 "${code}"를 삭제했습니다.\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  
  if (command === 'list') {
    await listCodes(args[1])
  } else if (command === 'delete') {
    if (!args[1]) {
      console.log('\n❌ 삭제할 코드를 지정해주세요.')
      console.log('   예: npm run delete-code ABCD1234\n')
      return
    }
    await deleteCode(args[1])
  } else {
    // 생성 (기본값 1개)
    const count = parseInt(command) || 1
    if (count < 1 || count > 100) {
      console.log('\n❌ 1~100 사이의 숫자를 입력해주세요.\n')
      return
    }
    await createCodes(count)
  }
}

main()
  .catch(e => {
    console.error('\n❌ 오류 발생:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
