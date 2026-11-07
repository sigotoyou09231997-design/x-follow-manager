// チャット（DM）の一覧を、決まった間隔で記録する。「どの時間帯・どの文のときに DM が来たか」の分析材料。
//
// 画面（/chat）が自分で読む一覧 API（GET /v1/chat_rooms/main_list）の答えをそのまま読む。画面の文字は読まない。
// 相手との会話の中身（メッセージ本文・名前）は記録しない。必要なのは「いつ・何件・誰から（番号）」だけ。
// 投稿・削除の最中には動かさず、周回の最後（画面を空にしたあと）にだけ呼ぶ。読めなくても投稿は止めない（投げない）。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** 一覧の答えから、記録する形にする。形が違えば null */
export function pickChats(listBody, requestTotal = null) {
  const rooms = listBody?.chat_rooms;
  if (!Array.isArray(rooms)) return null;
  const pinned = Array.isArray(listBody.pinned_chats) ? listBody.pinned_chats : [];
  const rows = [...pinned, ...rooms].flatMap((r) => {
    const last = r?.last_message;
    if (!r || r.id == null || !last) return [];
    const partners = (r.members ?? []).map((m) => m.id);
    return [{
      room: r.id,
      group: r.is_group === true,
      partner: partners[0] ?? null,
      unread: Number.isFinite(r.unread_count) ? r.unread_count : 0,
      lastId: last.id,
      lastAt: last.created_at,
      lastBy: partners.includes(last.user_id) ? "partner" : "me",
    }];
  });
  return { requests: Number.isFinite(requestTotal) ? requestTotal : null, rooms: rows };
}

/**
 * 画面の /chat を開き、一覧の答えを取る。page は、周回の最後で空になっている投稿役の画面。
 * 読めなければ null（投げない）。
 */
export async function readChats(page) {
  try {
    const listReply = page.waitForResponse((r) => new URL(r.url()).pathname === "/v1/chat_rooms/main_list", { timeout: 20000 });
    const reqReply = page.waitForResponse((r) => new URL(r.url()).pathname === "/v1/chat_rooms/total_chat_request", { timeout: 20000 }).catch(() => null);
    await page.goto("https://yay.space/chat", { waitUntil: "domcontentloaded" });
    const list = await (await listReply).json();
    const req = await (await reqReply)?.json().catch(() => null);
    return pickChats(list, req?.total ?? null);
  } catch {
    return null;
  }
}

/** 前回の記録から、新しく増えたもの。{ newRooms: 新しい会話の数, incoming: 相手からの新着があった会話の数 } */
export function diffChats(prev, next) {
  if (!prev || !next) return { newRooms: 0, incoming: 0, first: !prev };
  const before = new Map(prev.rooms.map((r) => [r.room, r]));
  let newRooms = 0;
  let incoming = 0;
  for (const r of next.rooms) {
    const b = before.get(r.room);
    if (!b) { newRooms++; if (r.lastBy === "partner") incoming++; continue; }
    if (r.lastId !== b.lastId && r.lastBy === "partner") incoming++;
  }
  return { newRooms, incoming, first: false };
}

export function lastSnapshot(file) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* 壊れた行は飛ばす */ }
  }
  return null;
}

export function appendSnapshot(file, snap, now = new Date()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ t: now.toISOString(), ...snap }) + "\n");
}

/** 前回から間隔(ms)が空いていれば true。記録が無い・読めないときも true */
export function dueForSnapshot(last, everyMs, now = Date.now()) {
  const t = last?.t ? new Date(last.t).getTime() : NaN;
  return !Number.isFinite(t) || now - t >= everyMs;
}
