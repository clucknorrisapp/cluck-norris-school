// Telegram room policy — the one place that knows which chats the Cluck bot must NEVER post in.
//
// Owner, 2026-09-17: "make sure it is not posting anything in rose." The OnlyRose community room
// belongs to the ROSE project; the Cluck Norris bot sits in it only so the ROSE buy bot can use the
// same token and so /price-style commands could be served there. Over the summer that shared seat
// leaked CLKN welcomes (2026-09-02), vault alerts (2026-08-31) and, on 2026-09-17, a whole window of
// replayed buy alerts into that room. Each leak was closed at its own call site; this module closes
// the class: every Telegram send in the app goes through server.js `tgApi()` (or one of the three
// direct senders that import this file), and a send whose chat_id is the OnlyRose room is REFUSED
// unless the caller says so explicitly — which only the ROSE bot's own send path, an operator's
// explicit `/api/tg-test?chat=`, and a buy competition the owner configured for that room do.
//
// Deletes and callback acknowledgements are not posts and are never refused, so the buy-comp
// board self-clean and button taps keep working.
const ROSE_ROOM_ID = String(process.env.ROSE_TG_CHAT_ID || "-1002625127458");

// Methods that put nothing new in front of members.
const SILENT_METHODS = new Set(["deleteMessage", "answerCallbackQuery"]);

function isRoseRoom(chatId) {
  return chatId != null && String(chatId) === ROSE_ROOM_ID;
}

// Decide whether a send may go out. Returns null when allowed, or a short reason when refused.
// `method` is the Telegram API method; `opts.roseRoomOk` is the explicit allow.
function refusal(chatId, method, opts) {
  if (!isRoseRoom(chatId)) return null;
  if (SILENT_METHODS.has(String(method))) return null;
  if (opts && opts.roseRoomOk === true) return null;
  return `the Cluck bot never posts in the OnlyRose room (${method || "send"} refused; pass roseRoomOk only from the ROSE bot's own path, an explicit tg-test chat=, or a comp configured for that room)`;
}

module.exports = { ROSE_ROOM_ID, isRoseRoom, refusal };
