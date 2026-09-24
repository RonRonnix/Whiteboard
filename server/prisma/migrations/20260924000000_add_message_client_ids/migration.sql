ALTER TABLE "RoomMessage" ADD COLUMN "clientId" TEXT;

UPDATE "RoomMessage" SET "clientId" = "id" WHERE "clientId" IS NULL;

ALTER TABLE "RoomMessage" ALTER COLUMN "clientId" SET NOT NULL;

CREATE UNIQUE INDEX "RoomMessage_roomId_clientId_key" ON "RoomMessage"("roomId", "clientId");
