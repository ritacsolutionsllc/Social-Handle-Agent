'use client';
import { useEffect } from 'react';
import { Alert, Button } from '@/components/ui';

/** Route-level error boundary: shows a safe message (no stack/secrets) with the digest for support. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('page.error', error.digest);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Alert tone="error" title="Something went wrong">
        The page could not be loaded. If the database or another service is unavailable, try again shortly.
        {error.digest && <span className="mt-1 block text-xs">Reference: {error.digest}</span>}
      </Alert>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
