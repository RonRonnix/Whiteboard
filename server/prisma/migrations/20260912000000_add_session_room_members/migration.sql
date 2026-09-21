-- CreateTable
CREATE TABLE "SessionRoomMember" (
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionRoomMember_pkey" PRIMARY KEY ("roomId", "userId")
);

-- Add existing room creators as members
INSERT INTO "SessionRoomMember" ("roomId", "userId")
SELECT "id", "createdById" FROM "SessionRoom";

-- CreateIndex
CREATE INDEX "SessionRoomMember_userId_idx" ON "SessionRoomMember"("userId");

-- AddForeignKey
ALTER TABLE "SessionRoomMember" ADD CONSTRAINT "SessionRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SessionRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionRoomMember" ADD CONSTRAINT "SessionRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;