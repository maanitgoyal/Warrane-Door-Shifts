import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

/* ── helpers ── */

function getSydneyParts(d: Date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Sydney",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value);
    return {
        year: get("year"), month: get("month") - 1, day: get("day"),
        hour: get("hour") % 24, minute: get("minute"), second: get("second"),
    };
}

function fakeUtcNow(): Date {
    const sp = getSydneyParts();
    return new Date(Date.UTC(sp.year, sp.month, sp.day, sp.hour, sp.minute, sp.second));
}

function formatUTCTime(date: Date) {
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function offsetLabel(minutes: number): string {
    if (minutes >= 60) {
        const h = minutes / 60;
        return `${h} hour${h !== 1 ? "s" : ""}`;
    }
    return `${minutes} minutes`;
}

function emailHtml(name: string, shiftStart: Date, shiftEnd: Date, offsetMinutes: number): string {
    const dateStr = shiftStart.toLocaleDateString("en-AU", {
        weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
    const timeStr = `${formatUTCTime(shiftStart)} – ${formatUTCTime(shiftEnd)}`;
    const label = offsetLabel(offsetMinutes);

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px;">
          <p style="margin:0;color:#c7d2fe;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Warrane Door Shifts</p>
          <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Shift Reminder</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;color:#94a3b8;font-size:15px;">Hi ${name.split(" ")[0]}, your shift starts in <strong style="color:#e2e8f0;">${label}</strong>.</p>
          <!-- Shift card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #1e293b;overflow:hidden;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 4px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Date</p>
              <p style="margin:0 0 16px;color:#f1f5f9;font-size:16px;font-weight:600;">${dateStr}</p>
              <p style="margin:0 0 4px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Time</p>
              <p style="margin:0;color:#f1f5f9;font-size:16px;font-weight:600;">${timeStr}</p>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#475569;font-size:13px;">Good luck on your shift!</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #1e293b;">
          <p style="margin:0;color:#334155;font-size:12px;">Warrane College Door Shifts · This is an automated reminder</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ── route handler ── */

export async function GET(request: Request) {
    // Verify cron secret
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const resend = new Resend(process.env.RESEND_API_KEY!);

    const now = fakeUtcNow();
    const nowMs = now.getTime();
    const windowMs = 10 * 60 * 1000; // ±10 minute window

    // Fetch users with notifications enabled
    const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, email, notification_offsets")
        .eq("notification_enabled", true)
        .not("email", "is", null);

    if (!users || users.length === 0) {
        return NextResponse.json({ sent: 0 });
    }

    const userIds = users.map((u) => u.id);

    // Fetch upcoming approved claims (shifts in next 25 hours)
    const next25h = new Date(nowMs + 25 * 3600000).toISOString();
    const { data: claims } = await supabaseAdmin
        .from("claims")
        .select("user_id, shift_id")
        .eq("status", "approved")
        .in("user_id", userIds);

    if (!claims || claims.length === 0) {
        return NextResponse.json({ sent: 0 });
    }

    const shiftIds = [...new Set(claims.map((c) => c.shift_id))];
    const { data: shifts } = await supabaseAdmin
        .from("shifts")
        .select("id, start_at, end_at")
        .in("id", shiftIds)
        .gt("start_at", now.toISOString())
        .lt("start_at", next25h);

    if (!shifts || shifts.length === 0) {
        return NextResponse.json({ sent: 0 });
    }

    const shiftMap = Object.fromEntries(shifts.map((s) => [s.id, s]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    let sent = 0;

    for (const claim of claims) {
        const shift = shiftMap[claim.shift_id];
        if (!shift) continue;
        const user = userMap[claim.user_id];
        if (!user) continue;
        const offsets: number[] = user.notification_offsets ?? [];

        for (const offsetMin of offsets) {
            const notifTimeMs = new Date(shift.start_at).getTime() - offsetMin * 60000;

            // Check if we're in the window for this notification
            if (notifTimeMs < nowMs - windowMs || notifTimeMs > nowMs + windowMs) continue;

            // Try to insert into notification_log (unique constraint prevents duplicates)
            const { error: logError } = await supabaseAdmin
                .from("notification_log")
                .insert({ user_id: claim.user_id, shift_id: claim.shift_id, offset_minutes: offsetMin });

            if (logError) {
                // Duplicate — already sent, skip
                continue;
            }

            // Send email
            const start = new Date(shift.start_at);
            const end = new Date(shift.end_at);
            const name = `${user.first_name} ${user.last_name}`;
            const label = offsetLabel(offsetMin);

            try {
                await resend.emails.send({
                    from: process.env.RESEND_FROM ?? "Warrane Door Shifts <onboarding@resend.dev>",
                    to: user.email,
                    subject: `Reminder: Your door shift starts in ${label}`,
                    html: emailHtml(name, start, end, offsetMin),
                });
                sent++;
            } catch (e) {
                console.error("[send-reminders] email send failed:", e);
            }
        }
    }

    return NextResponse.json({ sent });
}
