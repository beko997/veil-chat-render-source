import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import {
  CreateRoomBody,
  CreateRoomMessageBody,
  CreateRoomMessageParams,
  CreateRoomMessageResponse,
  CreateRoomResponse,
  ListRoomMessagesParams,
  ListRoomMessagesResponse,
  ListRoomsResponse,
} from "@workspace/api-zod";
import { db, roomMessagesTable, roomsTable } from "@workspace/db";

const router: IRouter = Router();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/rooms", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: roomsTable.id,
      metadataCiphertext: roomsTable.metadataCiphertext,
      metadataIv: roomsTable.metadataIv,
      createdAt: roomsTable.createdAt,
    })
    .from(roomsTable)
    .orderBy(desc(roomsTable.createdAt));
  const rooms = rows.map((room) => ({
    ...room,
    metadataCiphertext: room.metadataCiphertext ?? null,
    metadataIv: room.metadataIv ?? null,
  }));
  res.json(ListRoomsResponse.parse(rooms));
});

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [room] = await db
    .insert(roomsTable)
    .values({
      id: parsed.data.id,
      kind: "channel",
      name: "__sealed__",
      topic: null,
      metadataCiphertext: parsed.data.metadataCiphertext,
      metadataIv: parsed.data.metadataIv,
    })
    .returning();

  res.status(201).json(CreateRoomResponse.parse({
    id: room.id,
    metadataCiphertext: room.metadataCiphertext,
    metadataIv: room.metadataIv,
    createdAt: room.createdAt,
  }));
});

router.get("/rooms/:roomId/messages", async (req, res): Promise<void> => {
  const params = ListRoomMessagesParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.roomId)) {
    res.status(400).json({ error: "Invalid room ID" });
    return;
  }

  const [room] = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(eq(roomsTable.id, params.data.roomId));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const messages = await db
    .select()
    .from(roomMessagesTable)
    .where(eq(roomMessagesTable.roomId, params.data.roomId))
    .orderBy(asc(roomMessagesTable.createdAt))
    .limit(100);

  res.json(ListRoomMessagesResponse.parse(messages.map((message) => ({
    id: message.id,
    roomId: message.roomId,
    ciphertext: message.ciphertext,
    iv: message.iv,
    createdAt: message.createdAt,
  }))));
});

router.post("/rooms/:roomId/messages", async (req, res): Promise<void> => {
  const params = CreateRoomMessageParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.roomId)) {
    res.status(400).json({ error: "Invalid room ID" });
    return;
  }

  const parsed = CreateRoomMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [room] = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(eq(roomsTable.id, params.data.roomId));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const [message] = await db
    .insert(roomMessagesTable)
    .values({
      roomId: params.data.roomId,
      senderAlias: "Anonim",
      ciphertext: parsed.data.ciphertext,
      iv: parsed.data.iv,
    })
    .returning();

  res.status(201).json(CreateRoomMessageResponse.parse({
    id: message.id,
    roomId: message.roomId,
    ciphertext: message.ciphertext,
    iv: message.iv,
    createdAt: message.createdAt,
  }));
});

export default router;
