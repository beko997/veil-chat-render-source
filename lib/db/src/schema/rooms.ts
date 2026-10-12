import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roomKindEnum = pgEnum("room_kind", ["channel", "direct"]);

export const roomsTable = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: roomKindEnum("kind").notNull(),
  name: text("name").notNull(),
  topic: text("topic"),
  metadataCiphertext: text("metadata_ciphertext"),
  metadataIv: text("metadata_iv"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const roomMessagesTable = pgTable("room_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => roomsTable.id, { onDelete: "cascade" }),
  senderAlias: text("sender_alias").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertRoomSchema = createInsertSchema(roomsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof roomsTable.$inferSelect;
export type RoomMessage = typeof roomMessagesTable.$inferSelect;
