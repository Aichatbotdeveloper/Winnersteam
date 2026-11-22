"use client";

import { useEffect } from "react";
import { Button, EmptyState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="py-10">
      <EmptyState icon="error" title="Something went wrong" action={<Button icon="refresh" onClick={reset}>Try again</Button>}>
        This section could not be loaded. If it keeps happening, contact your administrator.{error.digest ? ` Reference: ${error.digest}` : ""}
      </EmptyState>
    </div>
  );
}
