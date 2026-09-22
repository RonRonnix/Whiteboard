CREATE TABLE "WhiteboardDocument" (
    "roomId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhiteboardDocument_pkey" PRIMARY KEY ("roomId")
);

CREATE TABLE "WhiteboardStroke" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "boardVersion" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "tool" TEXT NOT NULL DEFAULT 'pen',
    "points" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "redoInvalidatedAt" TIMESTAMP(3),
    CONSTRAINT "WhiteboardStroke_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhiteboardSnapshot" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "boardVersion" INTEGER NOT NULL,
    "operationCount" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhiteboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhiteboardStroke_roomId_clientId_key" ON "WhiteboardStroke"("roomId", "clientId");
CREATE INDEX "WhiteboardStroke_roomId_boardVersion_createdAt_idx" ON "WhiteboardStroke"("roomId", "boardVersion", "createdAt");
CREATE INDEX "WhiteboardStroke_roomId_userId_undoneAt_idx" ON "WhiteboardStroke"("roomId", "userId", "undoneAt");
CREATE INDEX "RoomMessage_roomId_createdAt_idx" ON "RoomMessage"("roomId", "createdAt");
CREATE INDEX "WhiteboardSnapshot_roomId_boardVersion_createdAt_idx" ON "WhiteboardSnapshot"("roomId", "boardVersion", "createdAt");

ALTER TABLE "WhiteboardDocument" ADD CONSTRAINT "WhiteboardDocument_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SessionRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhiteboardStroke" ADD CONSTRAINT "WhiteboardStroke_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SessionRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhiteboardStroke" ADD CONSTRAINT "WhiteboardStroke_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomMessage" ADD CONSTRAINT "RoomMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SessionRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomMessage" ADD CONSTRAINT "RoomMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhiteboardSnapshot" ADD CONSTRAINT "WhiteboardSnapshot_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "WhiteboardDocument"("roomId") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "WhiteboardDocument" ("roomId", "version", "createdAt", "updatedAt")
SELECT "id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "SessionRoom";
