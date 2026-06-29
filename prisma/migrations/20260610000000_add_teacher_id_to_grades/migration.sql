-- AlterTable
ALTER TABLE `grade` ADD COLUMN `teacherId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `grade` ADD CONSTRAINT `Grade_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `user`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateIndex
CREATE INDEX `Grade_teacherId_fkey` ON `grade`(`teacherId`);
