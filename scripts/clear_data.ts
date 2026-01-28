import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Clearing TrackedChannels...')
  const deleteResult = await prisma.trackedChannel.deleteMany({})
  console.log(`Cleared TrackedChannels: ${deleteResult.count}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
