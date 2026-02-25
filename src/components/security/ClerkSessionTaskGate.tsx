"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@clerk/nextjs";

import {
  CLERK_RESET_PASSWORD_TASK_ROUTE,
  shouldRedirectToResetPasswordTask,
} from "@/lib/security/clerkTasks";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());

export function ClerkSessionTaskGate() {
  const { isLoaded, session } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!CLERK_ENABLED || !isLoaded) {
      return;
    }

    const taskKey = session?.currentTask?.key;
    if (!shouldRedirectToResetPasswordTask({ pathname, taskKey })) {
      return;
    }

    const encodedPath = encodeURIComponent(pathname ?? "/");
    router.replace(`${CLERK_RESET_PASSWORD_TASK_ROUTE}?redirect_url=${encodedPath}`);
  }, [isLoaded, pathname, router, session?.currentTask?.key]);

  return null;
}
