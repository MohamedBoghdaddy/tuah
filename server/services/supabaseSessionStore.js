// express-session Store backed by Supabase Postgres via the existing
// supabase-js admin client — replaces connect-mongodb-session now that Mongo
// is retired. No new driver or credential needed (unlike connect-pg-simple,
// which would require a raw `pg` connection string this app doesn't have).
import session from "express-session";
import { supabaseAdmin } from "../config/supabase.js";

const TABLE = "sessions";

export class SupabaseSessionStore extends session.Store {
  async get(sid, callback) {
    try {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("sess, expire")
        .eq("sid", sid)
        .maybeSingle();
      if (error) return callback(error);
      if (!data || new Date(data.expire) <= new Date()) return callback(null, null);
      return callback(null, data.sess);
    } catch (err) {
      return callback(err);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const maxAge = sessionData.cookie?.maxAge;
      const expire = new Date(Date.now() + (typeof maxAge === "number" ? maxAge : 1000 * 60 * 60 * 24));
      const { error } = await supabaseAdmin
        .from(TABLE)
        .upsert({ sid, sess: sessionData, expire: expire.toISOString() }, { onConflict: "sid" });
      if (error) return callback?.(error);
      return callback?.();
    } catch (err) {
      return callback?.(err);
    }
  }

  async destroy(sid, callback) {
    try {
      const { error } = await supabaseAdmin.from(TABLE).delete().eq("sid", sid);
      if (error) return callback?.(error);
      return callback?.();
    } catch (err) {
      return callback?.(err);
    }
  }

  async touch(sid, sessionData, callback) {
    return this.set(sid, sessionData, callback);
  }
}
