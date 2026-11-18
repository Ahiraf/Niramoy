import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appointments } from "./scheduling";
import { users } from "./identity";

export const careMessages = pgTable("care_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  clientId: uuid("client_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [
  index("care_messages_thread_idx").on(t.appointmentId, t.createdAt, t.id),
  uniqueIndex("care_messages_retry_idx").on(t.senderId, t.clientId),
]);
