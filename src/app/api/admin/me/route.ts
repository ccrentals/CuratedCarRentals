import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { type AppTheme, isAppTheme, THEME_COOKIE_NAME } from "@/lib/theme";

type UserRow = {
  email: string;
  role: string | null;
  full_name?: string | null;
  username?: string | null;
  created_at?: string | null;
  last_login_at?: string | null;
  is_active?: boolean | null;
};

const PROFILE_KEY_PREFIX = "user_profile:";

function profileKey(userId: string) {
  return `${PROFILE_KEY_PREFIX}${userId}`;
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.toLowerCase().includes(column.toLowerCase());
}

function parseThemePreference(content: unknown): AppTheme | null {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as { theme?: unknown };
    return isAppTheme(parsed.theme) ? parsed.theme : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const userResult: { rows: UserRow[] } = await (async () => {
      try {
        return await dbQuery<UserRow>(
          "select email, role, full_name, username, created_at, last_login_at, is_active from users where id = $1 limit 1",
          [session.userId],
        );
      } catch (error) {
        if (isUndefinedColumn(error, "username") || isUndefinedColumn(error, "full_name")) {
          return await dbQuery<UserRow>(
            "select email, role, created_at from users where id = $1 limit 1",
            [session.userId],
          );
        }
        throw error;
      }
    })();

    const user = userResult.rows[0];
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    let theme: AppTheme | null = null;
    try {
      const profileResult = await dbQuery<{ content: string | null }>(
        "select content from admin_documents where key = $1 limit 1",
        [profileKey(session.userId)],
      );
      theme = parseThemePreference(profileResult.rows[0]?.content ?? null);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "42P01") {
        throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      userId: session.userId,
      role: user.role ?? session.role,
      email: user.email,
      fullName: user.full_name ?? null,
      username: user.username ?? null,
      createdAt: user.created_at ?? null,
      lastLoginAt: user.last_login_at ?? null,
      isActive: user.is_active ?? true,
      preferences: {
        theme,
      },
    });
  } catch (error) {
    logError("api.admin.me.GET", error, { userId: session.userId });
    return NextResponse.json({ ok: false, error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const nextTheme = body?.theme;
  if (!isAppTheme(nextTheme)) {
    return NextResponse.json({ ok: false, error: "Invalid theme selection" }, { status: 400 });
  }

  try {
    await dbQuery(
      "insert into admin_documents (key, content, updated_by) values ($1, $2, $3) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now()",
      [profileKey(session.userId), JSON.stringify({ theme: nextTheme }), session.userId],
    );
    const response = NextResponse.json({ ok: true, theme: nextTheme });
    response.cookies.set(THEME_COOKIE_NAME, nextTheme, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    return response;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01") {
      return NextResponse.json(
        { ok: false, error: "Settings storage table is not configured." },
        { status: 500 },
      );
    }
    logError("api.admin.me.PATCH", error, { userId: session.userId });
    return NextResponse.json({ ok: false, error: "Failed to update profile" }, { status: 500 });
  }
}
