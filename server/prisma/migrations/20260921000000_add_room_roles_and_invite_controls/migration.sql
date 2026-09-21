CREATE TYPE "RoomRole" AS ENUM ('owner', 'editor', 'viewer');

ALTER TABLE "SessionRoom"
  ADD COLUMN "inviteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "inviteRevokedAt" TIMESTAMP(3);

ALTER TABLE "SessionRoomMember"
  ADD COLUMN "role" "RoomRole" NOT NULL DEFAULT 'viewer';

UPDATE "SessionRoomMember" AS member
SET "role" = 'owner'
FROM "SessionRoom" AS room
WHERE member."roomId" = room."id"
  AND member."userId" = room."createdById";
