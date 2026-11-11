"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Old link: the dashboard is now /trips and /wallet. */
export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(window.location.hash === "#wallet" ? "/wallet" : "/trips");
  }, [router]);
  return null;
}
