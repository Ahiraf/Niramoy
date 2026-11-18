import { randomUUID } from "node:crypto";
import { GET, POST, PATCH } from "../../app/api/messages/route";
import { eq } from "drizzle-orm";
import * as t from "../../lib/db/schema";
import { setupWorld, teardownWorld, call } from "../harness";
import { requestAs, requestWithBadCsrf, seedAppointment, type World } from "../fixtures";

const BASE = "http://localhost:3000/api/messages";
let world: World;
let appointmentId: string;
beforeEach(async () => {
  world = await setupWorld();
  appointmentId = await seedAppointment(world, { doctor: world.doctor, patient: world.patientA,
    startUtc: "2026-11-18T05:00:00Z", status: "completed" });
});
afterEach(async () => { await teardownWorld(world); });
const payload = (body = "A question about my visit") => ({ appointmentId, body, clientId: randomUUID() });
const send = (actor = world.patientA, input = payload()) => call<{message:{id:string}}>(POST,
  requestAs(actor, BASE, { method: "POST", body: JSON.stringify(input) }));

it("exchanges persistent messages and read receipts between the two participants", async () => {
  const written = await send();
  expect(written.status).toBe(201);
  const inbox = await call<{conversations:{id:string;unread:number}[]}>(GET, requestAs(world.doctor, BASE));
  expect(inbox.body.conversations[0]).toMatchObject({ id: appointmentId, unread: 1 });
  const messages = await call<{messages:{id:string;body:string;mine:boolean}[]}>(GET,
    requestAs(world.doctor, `${BASE}?appointmentId=${appointmentId}`));
  expect(messages.body.messages[0]).toMatchObject({ body: "A question about my visit", mine: false });
  expect(await send(world.doctor, payload("Thank you for your message"))).toMatchObject({status:201});
  expect(await call(PATCH, requestAs(world.doctor, BASE, { method:"PATCH", body:JSON.stringify({appointmentId, ids:[written.body.message.id]}) }))).toMatchObject({status:200});
  const received = await call<{messages:{readAt:string;mine:boolean}[]}>(GET,
    requestAs(world.patientA, `${BASE}?appointmentId=${appointmentId}`));
  expect(received.body.messages[0]?.readAt).toBeTruthy();
  expect(received.body.messages[0]?.mine).toBe(true);
});

it("rejects unrelated patients, doctors and admins on every conversation operation", async () => {
  const message = await send();
  for (const actor of [world.patientB, world.otherDoctor, world.admin]) {
    expect((await call(GET, requestAs(actor, `${BASE}?appointmentId=${appointmentId}`))).status).toBeGreaterThanOrEqual(400);
    expect((await send(actor)).status).toBeGreaterThanOrEqual(400);
    expect((await call(PATCH, requestAs(actor, BASE, {method:"PATCH", body:JSON.stringify({appointmentId, ids:[message.body.message.id]})}))).status).toBeGreaterThanOrEqual(400);
  }
  const inbox = await call<{conversations:unknown[]}>(GET, requestAs(world.patientB, BASE));
  expect(inbox.body.conversations).toEqual([]);
});

it("requires a session and CSRF protection", async () => {
  expect((await call(GET, requestAs(null, BASE))).status).toBe(401);
  expect((await call(POST, requestWithBadCsrf(world.patientA, BASE, { method:"POST", body:JSON.stringify(payload()) }))).status).toBe(403);
});

it("deduplicates retries but rejects reuse with changed text", async () => {
  const input = payload();
  const first = await send(world.patientA, input);
  const retry = await send(world.patientA, input);
  expect(retry.body.message.id).toBe(first.body.message.id);
  expect((await send(world.patientA, {...input, body:"Changed"})).status).toBe(400);
  const rows = await world.h.db.select().from(t.careMessages);
  expect(rows).toHaveLength(1);
});

it("validates input, rejects sender spoofing and keeps message text out of audits", async () => {
  for (const input of [payload(" "), payload("a".repeat(2001)), {...payload(), senderId:world.doctor.userId}, {...payload(),appointmentId:"bad"}]) {
    expect((await send(world.patientA, input)).status).toBe(400);
  }
  await send(world.patientA, payload("unique private text 72819"));
  const audits = await world.h.db.select().from(t.auditLogs);
  expect(JSON.stringify(audits)).not.toContain("unique private text 72819");
});

it("keeps cancelled conversation history readable but rejects new messages", async () => {
  await send();
  await world.h.db.update(t.appointments).set({ status:"cancelled" }).where(eq(t.appointments.id,appointmentId));
  expect((await send()).status).toBe(422);
  expect((await call(GET, requestAs(world.patientA, `${BASE}?appointmentId=${appointmentId}`))).status).toBe(200);
});

it("paginates without dropping messages that share a timestamp", async () => {
  await world.h.db.insert(t.careMessages).values(Array.from({length:55}, (_,i) => ({
    appointmentId, senderId:world.patientA.userId, clientId:randomUUID(), body:`Message ${i}`, createdAt:new Date("2026-11-18T05:00:00Z"),
  })));
  const first = await call<{messages:{id:string}[];hasMore:boolean}>(GET, requestAs(world.doctor, `${BASE}?appointmentId=${appointmentId}`));
  expect(first.body.messages).toHaveLength(50);
  expect(first.body.hasMore).toBe(true);
  const older = await call<{messages:{id:string}[];hasMore:boolean}>(GET, requestAs(world.doctor, `${BASE}?appointmentId=${appointmentId}&before=${first.body.messages[0]!.id}`));
  expect(older.body.messages).toHaveLength(5);
  expect(older.body.hasMore).toBe(false);
  expect(new Set([...first.body.messages,...older.body.messages].map((m)=>m.id)).size).toBe(55);
});
