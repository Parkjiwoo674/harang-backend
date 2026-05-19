import prisma from './lib/prisma'

/**
 * 배포 환경에서는 seed 데이터를 사용하지 않습니다.
 * 관리자가 직접 회원가입을 통해 계정을 생성하세요.
 */
async function main() {
  const count = await prisma.user.count()
  if (count > 0) {
    console.log('✅ DB에 이미 데이터가 있습니다. seed를 건너뜁니다.')
    return
  }
  console.log('ℹ️  빈 DB입니다. /signup 페이지에서 계정을 생성하세요.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
